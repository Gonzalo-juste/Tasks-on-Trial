import json
import logging
from dataclasses import replace
from time import monotonic
from pathlib import Path
from .config import Settings
from .errors import ApiError
from .nebius_client import NebiusClient, ProviderFailure
from .schemas import (RunRequest, TrialResult, InterrogateRequest, InterrogateResult,
    AppealRequest, Meta, Change, Recommendation, RunProposal, validate_case,
    InitRequest, ReviseRequest, ReviseResult, RevisedOrder, DetailedStep)
from .state import StateStore, fingerprint
from .tribunal import build_result, accepted_decision, make_proposal, decide, fallback_recommendation
from .intake import lines_for, prepare
from .validation import verify_result

FIXTURES = Path(__file__).parent / 'fixtures'
logger = logging.getLogger('uvicorn.error.tribunal')

def fixture(name):
    return json.loads((FIXTURES/name).read_text())

def demo_case_matches(case):
    return fingerprint(case) == fingerprint(RunRequest.model_validate(fixture('run.request.json')).case)

def failure_meta(exc):
    return Meta(model=exc.model, llm_calls=exc.calls, latency_ms=exc.latency_ms)

class TrialService:
    def __init__(self, store=None, provider_factory=NebiusClient):
        self.store = store or StateStore()
        self.provider_factory = provider_factory

    async def init(self, request: InitRequest):
        lines_for(request)
        async with self.store.transaction('request:'+request.request_id):
            cached = self.store.cached('init', request)
            if cached:
                return cached
            settings = Settings.load()
            result = None
            if settings.mode != 'replay':
                try:
                    draft, _meta = await self.provider_factory(settings).init(request)
                    result = prepare(request, draft)
                except (ProviderFailure, ValueError, ApiError):
                    pass
            result = result or prepare(request)
            return self.store.remember('init', request, result)

    async def revise(self, request: ReviseRequest):
        validate_case(request.case)
        async with self.store.transaction('request:'+request.request_id):
            root = self.store.root_for(request.previous_result)
            async with self.store.transaction('session:'+root):
                cached = self.store.cached('revise', request)
                if cached:
                    return cached
                session = self.store.current(request, root)
                task = next(t.model_copy(deep=True) for t in session.case.tasks if t.id == request.task_id)
                task.facts.extend(session.facts.get(task.id, []))
                decision = next(d.model_copy(deep=True) for d in session.result.decisions if d.task_id == task.id)
                if decision.verdict == 'DISMISSED':
                    raise ApiError('INVALID_INPUT', 'Pardon or appeal this task before requesting a plan.', ['task_id'])
            # Inference does not mutate the trial. Do not serialize every plan
            # request behind a slow model while holding the session lock.
            settings = Settings.load()
            source, order = 'fallback', None
            started = monotonic()
            plan_settings = replace(settings, model=settings.plan_model or settings.model)
            if settings.mode != 'replay':
                try:
                    order, meta = await self.provider_factory(plan_settings).revise(task, decision, request.instruction)
                    if sum(s.minutes for s in order.action_plan) != decision.approved_min:
                        raise ValueError('Revised plan changed budget.')
                    source = 'live'
                    logger.info('revise_live model=%s calls=%s latency_ms=%s',plan_settings.model,meta.llm_calls,int((monotonic()-started)*1000))
                except (ProviderFailure, ValueError) as exc:
                    reason = exc.reason if isinstance(exc,ProviderFailure) else 'invalid_plan_budget'
                    calls = exc.calls if isinstance(exc,ProviderFailure) else 0
                    logger.warning('revise_fallback model=%s reason=%s calls=%s latency_ms=%s',plan_settings.model,reason,calls,int((monotonic()-started)*1000))
                    order = None
            else:
                logger.info('revise_fallback model=%s reason=replay_mode calls=0 latency_ms=0',plan_settings.model)
            if order is None:
                order = RevisedOrder(first_move=decision.first_move, done_when=decision.done_when,
                    action_plan=[DetailedStep(step=step.step, minutes=step.minutes,
                        detail='Follow this existing approved step. A new detailed plan is unavailable.')
                        for step in decision.action_plan])
            result = ReviseResult(request_id=request.request_id, task_id=task.id,
                source=source, **order.model_dump())
            async with self.store.transaction('session:'+root):
                # A pardon/appeal may have completed during inference. Never
                # return or cache a plan for its now-obsolete approved budget.
                self.store.current(request, root)
                # v4 is a light response: no calendar mutation or revision increment.
                return self.store.remember('revise', request, result)

    async def run(self, request: RunRequest):
        validate_case(request.case)
        async with self.store.transaction('request:'+request.request_id):
            cached = self.store.cached('run',request)
            if cached:
                current = self.store.sessions.get(request.request_id)
                return current.result.model_copy(deep=True) if current else cached
            current = self.store.existing_run(request)
            if current:
                return current
            settings = Settings.load()
            if settings.mode == 'replay':
                if not demo_case_matches(request.case):
                    raise ApiError('REPLAY_CASE_MISMATCH', 'Replay only supports the prepared demo case; switch to live mode for other tasks.', ['case'])
                result = TrialResult.model_validate(fixture('run.response.json'))
                result.request_id = request.request_id
                verify_result(request.case, result)
            else:
                meta = Meta()
                try:
                    proposal, meta = await self.provider_factory(settings).run(request.case)
                    result = build_result(request.case, proposal, request.request_id,'live', meta)
                    verify_result(request.case, result)
                except (ProviderFailure, ValueError) as exc:
                    if isinstance(exc, ProviderFailure):
                        meta = failure_meta(exc)
                        reason = exc.reason
                    else:
                        reason = 'invalid_live_result'
                    # Do not log model output, input facts or raw exception text.
                    logger.warning('run_fallback model=%s reason=%s error_type=%s calls=%s latency_ms=%s',
                        settings.model, reason, type(exc).__name__, meta.llm_calls, meta.latency_ms)
                    try:
                        result = build_result(request.case, None, request.request_id,'fallback', meta)
                        verify_result(request.case, result)
                    except ValueError as fallback_exc:
                        logger.error('run_unavailable reason=invalid_fallback error_type=%s', type(fallback_exc).__name__)
                        raise ApiError('PROVIDER_UNAVAILABLE',
                            'The court could not validate a safe result. Please retry.', status_code=503) from None
            self.store.register(request, result)
            return self.store.remember('run', request, result)

    async def interrogate(self, request: InterrogateRequest):
        async with self.store.transaction('request:'+request.request_id):
            return await self._interrogate(request)

    async def _interrogate(self, request: InterrogateRequest):
        validate_case(request.case)
        if request.question_type == 'free' and not request.question_text:
            raise ApiError('INVALID_INPUT', 'A free question needs question_text.', ['question_text'])
        root = self.store.root_for(request.previous_result)
        async with self.store.transaction('session:'+root):
            cached = self.store.cached('interrogate',request)
            if cached:
                return cached
            session = self.store.current(request,root)
            task = next(t.model_copy(deep=True) for t in session.case.tasks if t.id == request.task_id)
            task.facts.extend(session.facts.get(task.id, []))
            decision = next(d for d in session.result.decisions if d.task_id == task.id)
            settings = Settings.load()
            if settings.mode == 'replay' and demo_case_matches(request.case) and task.id == 'instagram' and request.question_type == 'purpose':
                result = InterrogateResult.model_validate(fixture('interrogate.response.json'))
                result.request_id = request.request_id
                result.base_revision = session.result.revision
            else:
                value = None
                if settings.mode != 'replay':
                    try:
                        value, _meta = await self.provider_factory(settings).interrogate(task,decision,request.question_type,request.question_text)
                    except ProviderFailure:
                        pass
                if value:
                    no_comment = value.answer.strip().rstrip('.').lower() == 'no comment'
                    result = InterrogateResult(request_id=request.request_id,
                        base_revision=session.result.revision,source='live',task_id=task.id,
                        question_type=request.question_type,answer=value.answer,
                        rating='evasive' if no_comment else value.rating,
                        credibility_delta=-0.1 if no_comment else value.credibility_delta,
                        proposal=make_proposal(task,value.proposal))
                else:
                    result = InterrogateResult(request_id=request.request_id,
                        base_revision=session.result.revision,source='fallback',task_id=task.id,
                        question_type=request.question_type,answer='No comment.',rating='evasive',credibility_delta=0,proposal=None)
            return self.store.remember('interrogate', request, result)

    async def appeal(self, request: AppealRequest):
        async with self.store.transaction('request:'+request.request_id):
            return await self._appeal(request)

    async def _appeal(self, request: AppealRequest):
        validate_case(request.case)
        root = self.store.root_for(request.previous_result)
        async with self.store.transaction('session:'+root):
            cached = self.store.cached('appeal',request)
            if cached:
                return cached
            session = self.store.current(request,root)
            if request.pardon:
                if request.accepted_replacement is not None:
                    raise ApiError('INVALID_INPUT', 'Choose either a pardon or a replacement.', ['pardon'])
                if session.pardons_used >= 2:
                    raise ApiError('PARDON_LIMIT', 'This trial has used its two pardons.', status_code=409)
                self.store.ensure_new_result_id(request.request_id)
                task = next(t for t in session.case.tasks if t.id == request.task_id)
                decisions = [d.model_copy(deep=True) for d in session.result.decisions]
                index = next(i for i,d in enumerate(decisions) if d.task_id == task.id)
                old = decisions[index]
                restored = decide(task, fallback_recommendation(task))
                restored.persona = old.persona.model_copy(deep=True)
                restored.reason = 'Pardoned by the user; original scope and duration restored.'
                decisions[index] = restored
                categories = {d.task_id:'health' for d in decisions if d.suggested_need and d.suggested_need.status == 'confirmed' and d.suggested_need.need.lower() == 'rest'}
                result = build_result(session.case, None, request.request_id, 'fallback', Meta(),
                    revision=session.result.revision+1, appeals_used=session.result.appeals_used,
                    decisions=decisions, categories=categories)
                result.judge_summary = f'Pardon granted. Original scope restored. {result.metrics.minutes_recovered} minutes recovered.'
                result.change = Change(task_id=task.id, previous_verdict=old.verdict,
                    new_verdict='APPROVED', previous_minutes_recovered=session.result.metrics.minutes_recovered,
                    delta_minutes_recovered=result.metrics.minutes_recovered-session.result.metrics.minutes_recovered,
                    new_fact=request.new_fact)
                if request.new_fact:
                    session.facts.setdefault(task.id, []).append(request.new_fact)
                session.pardons_used += 1
                self.store.update(root, result)
                return self.store.remember('appeal', request, result)
            if session.result.appeals_used >= 1:
                raise ApiError('APPEAL_LIMIT', 'This trial has already used its appeal. Run a new trial to change the case.', status_code=409)
            if not request.accepted_replacement:
                # No accepted scope means no change, no consumed appeal and no new revision.
                return self.store.remember('appeal',request,session.result.model_copy(deep=True))
            self.store.ensure_new_result_id(request.request_id)
            task = next(t for t in session.case.tasks if t.id == request.task_id)
            replacement = request.accepted_replacement
            if not task.minimum_min <= replacement.duration_min <= task.duration_min:
                raise ApiError('INVALID_INPUT', 'Replacement must respect the confirmed minimum and duration.', ['accepted_replacement.duration_min'])
            if replacement.duration_min == task.duration_min and replacement.title != task.title:
                raise ApiError('INVALID_INPUT','A replacement must be a smaller version in this MVP.', ['accepted_replacement'])
            case = session.case.model_copy(deep=True)
            for t in case.tasks:
                t.facts.extend(session.facts.get(t.id, []))
                if t.id == task.id and request.new_fact and request.new_fact not in t.facts:
                    t.facts.append(request.new_fact)
            decisions = [d.model_copy(deep=True) for d in session.result.decisions]
            index = next(i for i,d in enumerate(decisions) if d.task_id == task.id)
            old = decisions[index].model_copy(deep=True)
            settings = Settings.load()
            source, meta = 'live', Meta()
            replay = settings.mode == 'replay' and demo_case_matches(session.case)
            if replay:
                if not (task.id == 'instagram' and replacement.title == 'Screen-free break'
                        and replacement.duration_min == 15 and replacement.need == 'rest'):
                    raise ApiError('REPLAY_CASE_MISMATCH','This accepted replacement has no prepared replay.', ['accepted_replacement'])
                demo_decision = next(d for d in TrialResult.model_validate(fixture('appeal.response.json')).decisions if d.task_id == task.id)
                old.defense, old.prosecution = demo_decision.defense, demo_decision.prosecution
                source = 'replay'
                meta = Meta(model='example-model')
            else:
                try:
                    proposal, meta = await self.provider_factory(settings).run(case, task.id, request.new_fact, replacement)
                    r = proposal.decisions[0]
                    old.defense, old.prosecution = r.defense, r.prosecution
                    old.exchanges = [e.model_copy(deep=True) for e in r.exchanges]
                except ProviderFailure as exc:
                    source, meta = 'fallback', failure_meta(exc)
                    old.exchanges = []
                    old.defense = f'I request the accepted {replacement.duration_min} minutes for {replacement.title}.'[:200]
                    old.prosecution = 'The court applies your explicitly accepted replacement; live assessment is unavailable.'
            decisions[index] = accepted_decision(task, old, replacement)
            categories = {d.task_id:'health' for d in decisions if d.suggested_need and d.suggested_need.status == 'confirmed' and d.suggested_need.need.lower() == 'rest'}
            result = build_result(case,None,request.request_id,source,meta,
                revision=session.result.revision+1,appeals_used=1,decisions=decisions,categories=categories)
            result.change = Change(task_id=task.id,previous_verdict=old.verdict,
                new_verdict=decisions[index].verdict,
                previous_minutes_recovered=session.result.metrics.minutes_recovered,
                delta_minutes_recovered=result.metrics.minutes_recovered-session.result.metrics.minutes_recovered,
                new_fact=request.new_fact)
            if request.new_fact:
                session.facts.setdefault(task.id,[]).append(request.new_fact)
            self.store.update(root,result)
            return self.store.remember('appeal',request,result)
