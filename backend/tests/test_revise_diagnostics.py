"""Detailed-plan failure visibility, low-effort requests, and session concurrency."""
import asyncio
import json
import pytest
import httpx

from backend.config import Settings
from backend.errors import ApiError
from backend.nebius_client import NebiusClient, ProviderFailure
from backend.schemas import (RunRequest, TrialResult, RevisedOrder, DetailedStep,
                             ReviseRequest, AppealRequest, Meta)
from backend.service import TrialService, fixture
from backend.tests.test_v4 import client
from backend.tests.test_api import previous
from backend.tribunal import decide, fallback_recommendation, build_result


def order():
    return RevisedOrder(first_move='Open the urgent folder.', done_when='Five urgent replies are sent.',
        action_plan=[DetailedStep(step='Select urgent replies', minutes=3, detail='Select the five messages that need replies today.'),
                     DetailedStep(step='Write replies', minutes=9, detail='Answer the request in each selected message.'),
                     DetailedStep(step='Send and stop', minutes=3, detail='Send each reply and leave the other messages for later.')])


def test_glm_detailed_plan_uses_supported_low_effort():
    bodies=[]
    async def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={'choices':[{'message':{'content':order().model_dump_json()}}]})
    trial=RunRequest.model_validate(fixture('run.request.json'))
    task=trial.case.tasks[2]
    decision=TrialResult.model_validate(fixture('run.response.json')).decisions[2]
    async def check():
        return await NebiusClient(Settings(api_key='mock', model='zai-org/GLM-5.3'), httpx.MockTransport(handler)).revise(task,decision,'detail')
    result,_meta=asyncio.run(check())
    assert sum(s.minutes for s in result.action_plan)==15
    assert bodies[0]['reasoning_effort']=='low'
    assert 'chat_template_kwargs' not in bodies[0]  # Do not send unsupported thinking=false.


def test_revise_fallback_logs_reason_model_latency_and_source(client, monkeypatch, caplog):
    old=client.post('/api/trial/run',json=fixture('run.request.json')).json()
    monkeypatch.setenv('TRIAL_MODE','live')
    monkeypatch.setenv('NEBIUS_PLAN_MODEL','mock-plan-model')
    class Provider:
        def __init__(self,settings): pass
        async def revise(self,*args):
            raise ProviderFailure('timeout',calls=1,latency_ms=25000,model='mock-plan-model')
    from backend.main import app
    app.state.service.provider_factory=Provider
    body=dict(**previous(old,'diagnostic-plan'),instruction='detail');body['task_id']='emails'
    response=client.post('/api/trial/revise',json=body)
    assert response.status_code==200 and response.json()['source']=='fallback'
    assert 'revise_fallback model=mock-plan-model reason=timeout calls=1 latency_ms=' in caplog.text


def test_detailed_plan_requests_do_not_hold_session_lock(monkeypatch):
    async def check():
        started=asyncio.Event();release=asyncio.Event();calls=[]
        class Provider:
            def __init__(self,settings): pass
            async def revise(self,*args):
                calls.append(1)
                if len(calls)==2:started.set()
                await release.wait()
                return order(),Meta()
        service=TrialService(provider_factory=Provider)
        monkeypatch.setenv('TRIAL_MODE','replay')
        old=await service.run(RunRequest.model_validate(fixture('run.request.json')))
        monkeypatch.setenv('TRIAL_MODE','live')
        tasks=[]
        for index in range(2):
            body=dict(**previous(old.model_dump(mode='json'),f'parallel-{index}'),instruction='detail')
            body['task_id']='emails'
            tasks.append(asyncio.create_task(service.revise(ReviseRequest.model_validate(body))))
        try:
            await asyncio.wait_for(started.wait(),timeout=1)
        finally:
            release.set()
        results=await asyncio.gather(*tasks)
        assert all(r.source=='live' for r in results) and len(calls)==2
    asyncio.run(check())


def test_plan_becomes_stale_if_a_pardon_finishes_during_inference(monkeypatch):
    async def check():
        started=asyncio.Event();release=asyncio.Event()
        class Provider:
            def __init__(self,settings): pass
            async def revise(self,*args):
                started.set();await release.wait()
                return order(),Meta()
        service=TrialService(provider_factory=Provider)
        monkeypatch.setenv('TRIAL_MODE','replay')
        old=await service.run(RunRequest.model_validate(fixture('run.request.json')))
        monkeypatch.setenv('TRIAL_MODE','live')
        body=dict(**previous(old.model_dump(mode='json'),'plan-in-flight'),instruction='detail')
        body['task_id']='emails'
        pending=asyncio.create_task(service.revise(ReviseRequest.model_validate(body)))
        await asyncio.wait_for(started.wait(),timeout=1)
        try:
            pardon=dict(**previous(old.model_dump(mode='json'),'pardon-during-plan'),pardon=True)
            pardon['task_id']='emails'
            changed=await asyncio.wait_for(service.appeal(AppealRequest.model_validate(pardon)),timeout=1)
            assert changed.revision==2
        finally:
            release.set()
        with pytest.raises(ApiError) as caught:await pending
        assert caught.value.code=='REVISION_CONFLICT'
        assert ('revise','plan-in-flight') not in service.store.cache
    asyncio.run(check())


@pytest.mark.parametrize('mode',['quick','standard','grand','immediate'])
def test_all_trial_formats_are_accepted_without_changing_engine(mode):
    body=fixture('run.request.json')
    body['case']['rules']=dict(mode=mode,severity=.5,drama=.85 if mode=='grand' else .5)
    trial=RunRequest.model_validate(body)
    result=build_result(trial.case,None,'mode-test','fallback',Meta())
    assert result.metrics.original_min==405 and result.metrics.minutes_recovered==0


@pytest.mark.parametrize('fact',['Needs 20 minutes of travel','Travel is included in my estimate','El viaje tarda 20 minutos'])
def test_buffer_facts_do_not_become_work_reduction_evidence(fact):
    task=RunRequest.model_validate(fixture('run.request.json')).case.tasks[1]
    task.facts=[fact];task.buffer_min=20
    proposal=fallback_recommendation(task)
    proposal.recommendation='REDUCED';proposal.approved_min=30;proposal.fact_cited=fact
    result=decide(task,proposal)
    assert result.verdict=='REDUCED' and result.approved_min==30
    assert 'based on your fact' not in result.reason
    assert fact not in result.reason and result.saved_min==30
