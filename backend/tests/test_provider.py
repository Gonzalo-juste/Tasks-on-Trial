import asyncio
from dataclasses import replace
import json
from time import monotonic
import httpx
import pytest
from backend.config import Settings
from backend.nebius_client import NebiusClient, ProviderFailure
from backend.schemas import RunRequest
from backend.service import fixture
from backend.tests.test_engine import from_demo


def settings(**kwargs):
    return Settings(api_key='test-not-a-real-key',model='mock-model',**kwargs)


def success_payload():
    proposal=from_demo(RunRequest.model_validate(fixture('run.request.json')))
    return {'choices':[{'message':{'content':proposal.model_dump_json()}}]}


def test_invalid_json_then_success_is_one_retry():
    requests=[]
    async def handler(request):
        requests.append(request)
        if len(requests)==1:
            return httpx.Response(200,json={'choices':[{'message':{'content':'broken JSON'}}]})
        return httpx.Response(200,json=success_payload())
    async def check():
        case=RunRequest.model_validate(fixture('run.request.json')).case
        result,meta=await NebiusClient(settings(),httpx.MockTransport(handler)).run(case)
        assert len(result.decisions)==5 and meta.llm_calls==2
    asyncio.run(check())
    assert len(requests)==2


def test_unknown_provider_ids_are_retried_then_fail():
    calls=[]
    async def handler(request):
        calls.append(1)
        data=success_payload()
        content=json.loads(data['choices'][0]['message']['content'])
        content['decisions'][0]['task_id']='invented'
        data['choices'][0]['message']['content']=json.dumps(content)
        return httpx.Response(200,json=data)
    async def check():
        case=RunRequest.model_validate(fixture('run.request.json')).case
        with pytest.raises(ProviderFailure) as caught:
            await NebiusClient(settings(),httpx.MockTransport(handler)).run(case)
        assert caught.value.calls==2
    asyncio.run(check());assert len(calls)==2


def test_strict_schema_can_downgrade_once_inside_budget():
    formats=[]
    async def handler(request):
        kind=json.loads(request.content)['response_format']['type'];formats.append(kind)
        return httpx.Response(400,json={}) if kind=='json_schema' else httpx.Response(200,json=success_payload())
    async def check():
        case=RunRequest.model_validate(fixture('run.request.json')).case
        _,meta=await NebiusClient(settings(response_format='json_schema'),httpx.MockTransport(handler)).run(case)
        assert meta.llm_calls==2
    asyncio.run(check());assert formats==['json_schema','json_object']


def test_auth_failure_is_not_retried_or_leaked():
    calls=[]
    async def handler(request):
        calls.append(1)
        return httpx.Response(401,json={'error':'DO NOT LOG THIS PROVIDER BODY'})
    async def check():
        case=RunRequest.model_validate(fixture('run.request.json')).case
        with pytest.raises(ProviderFailure) as caught:
            await NebiusClient(settings(),httpx.MockTransport(handler)).run(case)
        assert caught.value.calls==1
        assert 'DO NOT LOG' not in str(caught.value)
    asyncio.run(check());assert len(calls)==1


def test_timeout_cancels_slow_provider():
    async def handler(request):
        await asyncio.sleep(5)
        return httpx.Response(200,json=success_payload())
    async def check():
        case=RunRequest.model_validate(fixture('run.request.json')).case
        started=monotonic()
        with pytest.raises(ProviderFailure) as caught:
            await NebiusClient(settings(timeout_seconds=0.05),httpx.MockTransport(handler)).run(case)
        assert monotonic()-started < 0.5
        assert caught.value.reason=='timeout'
    asyncio.run(check())
