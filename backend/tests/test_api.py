from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.service import TrialService, fixture
from backend.state import StateStore
from backend.nebius_client import ProviderFailure
from backend.schemas import RunProposal, InterrogationProposal, Meta
from backend.tests.test_engine import from_demo
from backend.schemas import RunRequest

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('TRIAL_MODE','replay')
    app.state.service=TrialService()
    with TestClient(app) as c:yield c


def run(client):
    response=client.post('/api/trial/run',json=fixture('run.request.json'))
    assert response.status_code == 200,response.text
    return response.json()


def previous(result, request_id='int-01'):
    return {'request_id':request_id,'api_version':'1','case':fixture('run.request.json')['case'],
        'previous_result':result,'base_revision':result['revision'],'task_id':'instagram'}


def appeal_body(result):
    return {**previous(result,'appeal-01'), 'new_fact':"I haven't taken a break in six hours.",
        'accepted_replacement':fixture('interrogate.response.json')['proposal']}


def test_replay_exact_fixture_and_cors(client):
    assert run(client) == fixture('run.response.json')
    r=client.options('/api/trial/run',headers={'Origin':'http://localhost:3000','Access-Control-Request-Method':'POST'})
    assert r.headers['access-control-allow-origin'] == 'http://localhost:3000'
    r=client.options('/api/trial/run',headers={'Origin':'https://untrusted.example','Access-Control-Request-Method':'POST'})
    assert 'access-control-allow-origin' not in r.headers


def test_interrogate_then_appeal_and_duplicate(client):
    result=run(client)
    question={**previous(result),'question_type':'purpose','question_text':None}
    q=client.post('/api/trial/interrogate',json=question)
    assert q.status_code == 200 and q.json() == fixture('interrogate.response.json')
    assert client.post('/api/trial/run',json=fixture('run.request.json')).json()['revision'] == 1
    body=appeal_body(result)
    response=client.post('/api/trial/appeal',json=body)
    assert response.status_code == 200,response.text
    changed=response.json()
    assert changed['revision'] == 2 and changed['appeals_used'] == 1
    assert changed['metrics'] == fixture('appeal.response.json')['metrics']
    assert changed['schedule'] == fixture('appeal.response.json')['schedule']
    assert changed['change']['delta_minutes_recovered'] == -15
    assert client.post('/api/trial/appeal',json=body).json() == changed
    stale=deepcopy(body);stale['request_id']='stale-appeal'
    assert client.post('/api/trial/appeal',json=stale).status_code == 409
    again=appeal_body(changed);again['request_id']='appeal-02'
    assert client.post('/api/trial/appeal',json=again).json()['error']['code'] == 'APPEAL_LIMIT'


def test_no_acceptance_does_not_change_or_consume(client):
    result=run(client);body=appeal_body(result);body['accepted_replacement']=None
    response=client.post('/api/trial/appeal',json=body)
    assert response.json() == result
    body['request_id']='accepted-later';body['accepted_replacement']=fixture('interrogate.response.json')['proposal']
    assert client.post('/api/trial/appeal',json=body).json()['revision'] == 2


def test_tampered_result_and_case_rejected(client):
    result=run(client)
    body=appeal_body(result);body['previous_result']['metrics']['minutes_recovered']=999
    assert client.post('/api/trial/appeal',json=body).status_code == 409
    body=appeal_body(result);body['case']['tasks'][0]['mandatory']=False
    assert client.post('/api/trial/appeal',json=body).json()['error']['code'] == 'CASE_CONFLICT'


def test_request_id_conflict_and_replay_does_not_fake_other_cases(client):
    run(client)
    body=fixture('run.request.json');body['case']['tasks'][0]['title']='Other task'
    assert client.post('/api/trial/run',json=body).status_code == 409
    body['request_id']='other-case'
    assert client.post('/api/trial/run',json=body).json()['error']['code'] == 'REPLAY_CASE_MISMATCH'

@pytest.mark.parametrize('value',[0,-1,1.5,True,'30'])
def test_bad_duration_has_field_path_without_echoing_input(client,value):
    body=fixture('run.request.json');body['case']['tasks'][0]['duration_min']=value
    r=client.post('/api/trial/run',json=body)
    assert r.status_code == 422
    assert r.json()['error']['code'] == 'INVALID_INPUT'
    assert 'case.tasks[0].duration_min' in r.json()['error']['fields']


def test_invalid_input_never_calls_provider(client,monkeypatch):
    def forbidden(_):raise AssertionError('Provider must not be used')
    app.state.service.provider_factory=forbidden
    monkeypatch.setenv('TRIAL_MODE','live')
    body=fixture('run.request.json');body['case']['tasks'][0]['depends_on']=['maths']
    assert client.post('/api/trial/run',json=body).status_code == 422


def test_missing_credentials_fallback_preserves_work(client,monkeypatch):
    monkeypatch.setenv('TRIAL_MODE','live');monkeypatch.setenv('NEBIUS_API_KEY','');monkeypatch.setenv('NEBIUS_MODEL','')
    r=run(client)
    assert r['source'] == 'fallback'
    assert r['metrics']['minutes_recovered'] == 0
    assert all(d['verdict'] == 'APPROVED' for d in r['decisions'])
    assert r['meta']['llm_calls'] == 0


def test_live_and_fallback_on_provider_failure(client,monkeypatch):
    monkeypatch.setenv('TRIAL_MODE','live')
    class Fake:
        def __init__(self,s):pass
        async def run(self,case,*args):return from_demo(RunRequest.model_validate(fixture('run.request.json'))),Meta(model='test',llm_calls=1)
    app.state.service.provider_factory=Fake
    result=run(client)
    assert result['source'] == 'live' and result['metrics']['minutes_recovered'] == 120
    class Broken(Fake):
        async def run(self,*args):raise ProviderFailure('timeout',2,25,'test')
    app.state.service.provider_factory=Broken
    body=fixture('run.request.json');body['request_id']='timeout'
    r=client.post('/api/trial/run',json=body).json()
    assert r['source'] == 'fallback' and r['meta']['llm_calls'] == 2

@pytest.mark.parametrize('rating,answer,delta',[('supported','I serve the confirmed need.',0.2),('evasive','No comment.',-0.1),('contradiction','My request exceeds my own confirmed scope.',-0.3)])
def test_interrogation_ratings(client,monkeypatch,rating,answer,delta):
    result=run(client);monkeypatch.setenv('TRIAL_MODE','live')
    class Fake:
        def __init__(self,s):pass
        async def interrogate(self,*args):return InterrogationProposal(answer=answer,rating=rating,credibility_delta=delta),Meta()
    app.state.service.provider_factory=Fake
    body={**previous(result),'question_type':'purpose'}
    response=client.post('/api/trial/interrogate',json=body)
    assert response.status_code == 200,response.text
    assert response.json()['rating'] == rating
    assert response.json()['credibility_delta'] == delta
    assert app.state.service.store.sessions['run-01'].result.revision == 1


def test_free_question_requires_text(client):
    r=run(client)
    response=client.post('/api/trial/interrogate',json={**previous(r),'question_type':'free'})
    assert response.status_code == 422


def test_invalid_replacement_preserves_previous(client):
    r=run(client);body=appeal_body(r);body['accepted_replacement']['duration_min']=1
    assert client.post('/api/trial/appeal',json=body).status_code == 422
    assert app.state.service.store.sessions['run-01'].result.revision == 1


def test_unknown_session_and_malformed_json(client):
    r=fixture('run.response.json')
    assert client.post('/api/trial/appeal',json=appeal_body(r)).status_code == 409
    response=client.post('/api/trial/run',content='{',headers={'Content-Type':'application/json'})
    assert response.status_code == 422 and response.json()['error']['code'] == 'INVALID_INPUT'


def test_retrying_original_run_after_appeal_returns_latest(client):
    result=run(client)
    changed=client.post('/api/trial/appeal',json=appeal_body(result)).json()
    assert client.post('/api/trial/run',json=fixture('run.request.json')).json() == changed


def test_concurrent_duplicate_appeals_are_idempotent(client):
    result=run(client);body=appeal_body(result)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:client.post('/api/trial/appeal',json=body), range(2)))
    assert all(r.status_code==200 for r in responses)
    assert responses[0].json()==responses[1].json()
    assert app.state.service.store.sessions['run-01'].result.appeals_used == 1


def test_concurrent_duplicate_runs_only_call_provider_once(client,monkeypatch):
    import asyncio
    monkeypatch.setenv('TRIAL_MODE','live')
    calls=[]
    class Fake:
        def __init__(self,s):pass
        async def run(self,*args):
            calls.append(1)
            await asyncio.sleep(0.03)
            return from_demo(RunRequest.model_validate(fixture('run.request.json'))),Meta(model='mock',llm_calls=1)
    app.state.service.provider_factory=Fake
    body=fixture('run.request.json')
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:client.post('/api/trial/run',json=body),range(2)))
    assert len(calls)==1
    assert all(r.status_code == 200 for r in responses)
    assert responses[0].json()==responses[1].json()


def test_accepted_replacement_applies_locally_without_inference(client,monkeypatch):
    result=run(client)
    monkeypatch.setenv('TRIAL_MODE','live')
    monkeypatch.setenv('NEBIUS_API_KEY','')
    monkeypatch.setenv('NEBIUS_MODEL','')
    response=client.post('/api/trial/appeal',json=appeal_body(result))
    assert response.status_code==200,response.text
    changed=response.json()
    assert changed['source']=='fallback' and changed['metrics']['minutes_recovered']==105
    assert 'accepted replacement' in changed['judge_summary']
    assert changed['meta']['llm_calls']==0


def test_replay_unknown_question_never_calls_provider(client):
    result=run(client)
    def forbidden(_):raise AssertionError('Replay must never contact a provider')
    app.state.service.provider_factory=forbidden
    body={**previous(result),'question_type':'why_today'}
    r=client.post('/api/trial/interrogate',json=body)
    assert r.status_code==200 and r.json()['answer']=='No comment.'
    assert r.json()['source']=='fallback'
