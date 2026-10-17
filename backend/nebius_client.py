"""Bounded asynchronous OpenAI-compatible calls, with no sensitive logging."""
import asyncio
import json
import logging
from time import monotonic
from typing import TypeVar
import httpx
from pydantic import BaseModel, ValidationError
from .config import Settings
from .prompts import RUN_SYSTEM, INTERROGATE_SYSTEM, INIT_SYSTEM, REVISE_SYSTEM
from .schemas import Case, RunProposal, InterrogationProposal, Meta, InitDraft, RevisedOrder, provider_run_schema
from .courtroom import round_count, validate_exchanges, validate_personal_history
from .evaluation import burden_score

logger = logging.getLogger('uvicorn.error.provider')
T = TypeVar('T', bound=BaseModel)

class ProviderFailure(Exception):
    def __init__(self, reason, calls=0, latency_ms=0, model=None):
        self.reason, self.calls, self.latency_ms, self.model = reason, calls, latency_ms, model
        super().__init__(reason)

class NebiusClient:
    def __init__(self, settings: Settings, transport=None):
        self.settings = settings
        self.transport = transport

    async def generate(self, system: str, payload: dict, schema: type[T], validate=None, temperature=0.2) -> tuple[T, Meta]:
        s = self.settings
        if not s.api_key or not s.model:
            logger.warning('provider_fallback operation=%s model=%s reason=not_configured calls=0 latency_ms=0',schema.__name__,s.model or 'unset')
            raise ProviderFailure('not_configured', model=s.model or None)
        started = monotonic()
        calls = 0
        response_format = s.response_format
        reason = 'provider_error'
        try:
            async with asyncio.timeout(s.timeout_seconds):
                async with httpx.AsyncClient(transport=self.transport) as client:
                    for attempt in range(2):
                        remaining = s.timeout_seconds-(monotonic()-started)
                        if remaining <= 0:
                            break
                        response_spec = {'type':'json_object'}
                        if response_format == 'json_schema':
                            response_spec = {'type':'json_schema', 'json_schema':{
                                'name':schema.__name__, 'strict':True, 'schema':schema.model_json_schema()}}
                        body = {'model':s.model, 'messages':[
                            {'role':'system', 'content':system+'\nJSON schema:\n'+json.dumps(schema.model_json_schema())},
                            {'role':'user', 'content':json.dumps(payload, ensure_ascii=False)}],
                            'response_format':response_spec, 'temperature':temperature, 'max_tokens':6000}
                        # Verified provider-specific control for direct structured output:
                        # https://github.com/nebius/nebius-physical-ai/blob/main/docs/workbench/token-factory-deprecation-verification.md
                        if s.model == 'nvidia/Nemotron-3_5-Lightning':
                            body['chat_template_kwargs'] = {'enable_thinking':False}
                        if s.model in {'zai-org/GLM-5.3', 'zai-org/GLM-5.3-Flash'}:
                            # GLM-5.3 cannot disable thinking; use its documented low effort.
                            body['reasoning_effort'] = 'low'
                        try:
                            calls += 1
                            attempt_started = monotonic()
                            response = await client.post(s.base_url+'/chat/completions',
                                headers={'Authorization':'Bearer '+s.api_key}, json=body,
                                timeout=remaining)
                            if response.status_code >= 400:
                                logger.warning('provider_http_error operation=%s model=%s attempt=%s status=%s latency_ms=%s',
                                    schema.__name__,s.model,calls,response.status_code,int((monotonic()-attempt_started)*1000))
                            if response.status_code in (401,403,404):
                                reason = f'provider_status_{response.status_code}'
                                break
                            if response.status_code == 400 and response_format == 'json_schema':
                                response_format = 'json_object'
                                reason = 'unsupported_schema'
                                continue
                            response.raise_for_status()
                            logger.info('provider_response operation=%s model=%s attempt=%s latency_ms=%s', schema.__name__,s.model,calls,int((monotonic()-attempt_started)*1000))
                            message = response.json()['choices'][0]['message']['content']
                            parsed = schema.model_validate_json(message)
                            if validate:
                                validate(parsed)
                            meta = Meta(model=s.model, llm_calls=calls, latency_ms=int((monotonic()-started)*1000))
                            logger.info('provider_ok operation=%s model=%s calls=%s latency_ms=%s', schema.__name__,s.model,calls,meta.latency_ms)
                            return parsed, meta
                        except (httpx.HTTPError, ValidationError, ValueError, KeyError, IndexError, TypeError) as exc:
                            reason = type(exc).__name__  # never include response body or task contents
                            if isinstance(exc,ValueError) and not isinstance(exc,ValidationError):
                                reason = {
                                    'Exchange count does not match requested rounds.':'exchange_count',
                                    'Exchanges must alternate defense and prosecution each round.':'exchange_order',
                                    'Repeated exchange text.':'exchange_repetition',
                                    'Compatibility speeches must equal round one.':'round_one_mismatch',
                                    'Score adjustment requires a short reason.':'score_reason_missing',
                                    'Unconfirmed personal history in exchange.':'ungrounded_personal_history',
                                }.get(str(exc),reason)
                            fields = [('.'.join(map(str,e['loc'])), e['type']) for e in exc.errors(include_input=False)] if isinstance(exc,ValidationError) else []
                            logger.warning('provider_retry operation=%s model=%s attempt=%s reason=%s fields=%s',schema.__name__,s.model,calls,reason,fields)
        except TimeoutError:
            reason = 'timeout'
        elapsed = int((monotonic()-started)*1000)
        logger.warning('provider_fallback operation=%s model=%s reason=%s calls=%s latency_ms=%s timeout_seconds=%s',schema.__name__,s.model,reason,calls,elapsed,s.timeout_seconds)
        raise ProviderFailure(reason, calls, elapsed, s.model)

    async def run(self, case: Case, target_id=None, new_fact=None, replacement=None):
        expected = {target_id} if target_id else {t.id for t in case.tasks}
        def validate(value):
            ids = [d.task_id for d in value.decisions]
            if len(ids) != len(set(ids)) or set(ids) != expected:
                raise ValueError('Unexpected task IDs')
            for decision in value.decisions:
                task = next(t for t in case.tasks if t.id == decision.task_id)
                if decision.exchanges:
                    try:
                        validate_exchanges(decision.exchanges,round_count(case),decision.defense,decision.prosecution)
                        validate_personal_history(decision.exchanges,task)
                    except ValueError:
                        logger.warning('provider_exchanges_dropped reason=invalid_optional_exchanges')
                        decision.exchanges = []
                if decision.score_adjustment and not decision.score_reason:
                    raise ValueError('Score adjustment requires a short reason.')
        case_payload = case.model_dump(mode='json')
        if case.rules and case.rules.mode == 'grand':
            case_payload['rules']['drama'] = 1
        payload = {'case':case_payload, 'target_ids':sorted(expected),
                   'rounds':round_count(case),
                   'burden_of_proof':{t.id:burden_score(case,t).payload() for t in case.tasks if not t.mandatory}}
        if target_id:
            payload.update(target_id=target_id, new_fact=new_fact,
                           accepted_replacement=replacement.model_dump(mode='json') if replacement else None)
        value, meta = await self.generate(RUN_SYSTEM, payload, provider_run_schema(round_count(case)), validate, temperature=0)
        return RunProposal.model_validate(value.model_dump()), meta

    async def init(self, request):
        from .intake import prepare
        from .errors import ApiError
        def validate(draft):
            try:
                prepare(request, draft)
            except ApiError as exc:
                raise ValueError('Invalid intake case.') from exc
        return await self.generate(INIT_SYSTEM, request.model_dump(mode='json'), InitDraft, validate, temperature=0)

    async def revise(self, task, decision, instruction):
        def validate(order):
            if sum(step.minutes for step in order.action_plan) != decision.approved_min:
                raise ValueError('Revised plan changed the approved budget.')
        return await self.generate(REVISE_SYSTEM, {
            'task':task.model_dump(mode='json'), 'decision':decision.model_dump(mode='json'),
            'instruction':instruction}, RevisedOrder, validate, temperature=0)

    async def interrogate(self, task, decision, question_type, question_text):
        return await self.generate(INTERROGATE_SYSTEM, {
            'task':task.model_dump(mode='json'), 'decision':decision.model_dump(mode='json'),
            'question_type':question_type, 'question_text':question_text}, InterrogationProposal)
