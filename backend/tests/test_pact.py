"""Pacts are explicit local user decisions, with original-cost conservation."""
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.service import TrialService
from backend.schemas import RunRequest, Meta, Release
from backend.tribunal import build_result, decide, fallback_recommendation, allocate_work
from backend.validation import verify_result

@pytest.fixture
def pact_case(monkeypatch):
    monkeypatch.setenv('TRIAL_MODE','live')
    case={'constitution':{'timezone':'Europe/London','start':'2026-10-17T12:00:00+01:00','end':'2026-10-17T16:30:00+01:00','priorities':['work','health','learning','leisure'],'fixed_blocks':[{'start':'2026-10-17T13:00:00+01:00','end':'2026-10-17T13:30:00+01:00','label':'Lunch'}]},'budget_min':210,'rules':{'mode':'quick','rounds':1},'tasks':[]}
    for id,cat,minutes,minimum in [('slides','work',90,70),('study','learning',90,90),('gym','health',60,30),('run','health',30,15),('emails','work',30,10),('tiktok','leisure',45,15)]:
        case['tasks'].append(dict(id=id,title=id,duration_min=minutes,minimum_min=minimum,mandatory=id=='study',allow_reduction=True,category=cat,facts=[],buffer_min=20 if id=='gym' else 0))
    request=RunRequest.model_validate(dict(request_id='pact-run',confirmed=True,case=case))
    decisions=[decide(t,fallback_recommendation(t)) for t in request.case.tasks]
    for task,d in zip(request.case.tasks,decisions):
        if task.id in ('gym','run','tiktok'):
            d.verdict='DISMISSED';d.approved_min=0;d.saved_min=task.duration_min+task.buffer_min
            d.first_move=None;d.action_plan=[];d.done_when=None;d.release=Release(note='Not today.')
        elif task.id!='study':
            allocate_work(task,d,task.minimum_min,'Accepted scope.')
    result=build_result(request.case,None,request.request_id,'fallback',Meta(),decisions=decisions)
    def forbidden(_):raise AssertionError('Accepted pact must not call a provider')
    app.state.service=TrialService(provider_factory=forbidden)
    app.state.service.store.register(request,result)
    body=dict(request_id='accept-pact',api_version='1',case=case,previous_result=result.model_dump(mode='json'),base_revision=1,task_id='gym',merge_task_ids=['run'],accepted_replacement=dict(title='Run to the gym + strength session',duration_min=40,need='health',buffer_min=0,saved_min=999,first_move='Put on running shoes.',action_plan=[dict(step='Run to the gym',minutes=15),dict(step='Strength session',minutes=25)],done_when='Run and strength session completed.'))
    return request,body

def test_exact_demo_pact_and_idempotency(pact_case):
    request,body=pact_case
    with TestClient(app) as client:
        r=client.post('/api/trial/appeal',json=body)
        assert r.status_code==200,r.text
        result=r.json();gym=next(d for d in result['decisions'] if d['task_id']=='gym');run=next(d for d in result['decisions'] if d['task_id']=='run')
        assert gym['approved_min']==40 and gym['buffer_min']==0 and gym['saved_min']==40
        assert [s['minutes'] for s in gym['action_plan']]==[15,25]
        assert 'Pact accepted' in gym['reason']
        assert run['verdict']=='DISMISSED' and run['approved_min']==0 and run['saved_min']==30
        assert run['merged_into']=='gym' and run['reason']=='merged into Run to the gym + strength session'
        assert result['metrics']==dict(original_min=365,approved_min=210,minutes_recovered=155,pending_min=0,free_capacity_min=0)
        # Window has 240 free minutes; granted budget is 210, so free capacity is 0.
        assert client.post('/api/trial/appeal',json=body).json()==result
        from backend.schemas import TrialResult
        verify_result(request.case,TrialResult.model_validate(result))
        new={**body,'request_id':'pardon-merged','previous_result':result,'base_revision':2,'task_id':'run','pardon':True,'merge_task_ids':[],'accepted_replacement':None}
        assert client.post('/api/trial/appeal',json=new).status_code==422

@pytest.mark.parametrize('ids',[['missing'],['gym'],['study'],['run','run'],['emails']])
def test_invalid_merge_is_atomic(pact_case,ids):
    _,body=pact_case;body['merge_task_ids']=ids
    with TestClient(app) as client:
        assert client.post('/api/trial/appeal',json=body).status_code==422
        assert app.state.service.store.sessions['pact-run'].result.revision==1

def test_impossible_pact_does_not_mutate_session(pact_case):
    _,body=pact_case
    body['accepted_replacement']['duration_min']=60;body['accepted_replacement']['title']='gym'
    body['accepted_replacement']['action_plan']=[dict(step='Run then train',minutes=60)]
    # Enough adjustable tasks could otherwise be reduced; study+gym alone cannot fit 100.
    session=app.state.service.store.sessions['pact-run'];session.case.budget_min=100;body['case']['budget_min']=100
    with TestClient(app) as client:
        r=client.post('/api/trial/appeal',json=body)
        assert r.status_code==422,r.text
        assert session.result.revision==1

def test_pact_refits_other_work_without_readmitting_run(pact_case):
    request,body=pact_case
    session=app.state.service.store.sessions['pact-run']
    decisions=[d.model_copy(deep=True) for d in session.result.decisions]
    for d in decisions:
        if d.task_id in ('slides','emails'):
            task=next(t for t in request.case.tasks if t.id==d.task_id)
            allocate_work(task,d,task.duration_min,'Original scope.')
    result=build_result(request.case,None,'pact-run','fallback',Meta(),decisions=decisions)
    session.result=result;body['previous_result']=result.model_dump(mode='json')
    with TestClient(app) as client:
        r=client.post('/api/trial/appeal',json=body)
        assert r.status_code==200,r.text
        decisions={d['task_id']:d for d in r.json()['decisions']}
        assert {id:decisions[id]['approved_min'] for id in ('slides','study','emails','gym','run')}==dict(slides=70,study=90,emails=10,gym=40,run=0)
        assert r.json()['metrics']['pending_min']==0
        assert r.json()['metrics']['approved_min']==210

@pytest.mark.parametrize('value',[-1,21,True])
def test_invalid_buffer_does_not_mutate_session(pact_case,value):
    _,body=pact_case;body['accepted_replacement']['buffer_min']=value
    with TestClient(app) as client:
        r=client.post('/api/trial/appeal',json=body)
        assert r.status_code==422,r.text
        assert app.state.service.store.sessions['pact-run'].result.revision==1
