"""Break costs belong to calendar capacity, not to work or recovered minutes."""
from datetime import timedelta
import random
import pytest
from pydantic import ValidationError

from backend.schemas import Case, Constitution, FixedBlock, Meta, RunProposal
from backend.tribunal import build_result, fallback_recommendation
from backend.validation import verify_result


def case_for(tasks=None, budget=120, rest=10):
    return Case.model_validate(dict(budget_min=budget,
        constitution=dict(start='2026-10-17T12:00:00+01:00',end='2026-10-17T14:00:00+01:00',
            priorities=['work','health'],break_min=rest),tasks=tasks or [
        dict(id='a',title='First task',duration_min=30,minimum_min=15,category='work',allow_reduction=True),
        dict(id='b',title='Second task',duration_min=30,minimum_min=15,category='health',allow_reduction=True)]))


def result_for(case, dismissed=(), source='live'):
    rows=[fallback_recommendation(t) for t in case.tasks]
    for row in rows:
        if row.task_id in dismissed:row.recommendation,row.approved_min='DISMISSED',0
    return build_result(case,RunProposal(decisions=rows) if source=='live' else None,'break-test',source,Meta())


def test_two_tasks_have_one_break_and_work_metrics_do_not_include_it():
    case=case_for();result=result_for(case)
    assert [s.rest_after_min for s in result.schedule]==[10,0]
    assert [(s.end-s.start).total_seconds()/60 for s in result.schedule]==[40,30]
    assert result.metrics.model_dump()==dict(original_min=60,approved_min=60,minutes_recovered=0,
        pending_min=0,free_capacity_min=50)
    assert 'rest_after_min' not in result.schedule[-1].model_dump(mode='json')
    assert result.schedule[0].model_dump()['rest_after_min']==10


def test_single_task_never_gets_a_final_break():
    case=case_for();case.tasks=case.tasks[:1]
    result=result_for(case)
    assert result.schedule[0].rest_after_min==0 and result.metrics.free_capacity_min==90


def test_lunch_replaces_the_break_even_when_there_is_idle_time_before_it():
    case=case_for()
    case.constitution.end+=timedelta(minutes=30)
    case.constitution.fixed_blocks=[FixedBlock(start=case.constitution.start+timedelta(hours=1),
        end=case.constitution.start+timedelta(minutes=90),label='Lunch')]
    # Without a break these tasks would both fit before lunch. There is not room
    # for the required intermediate break, so the next task waits until lunch ends.
    case.tasks[0].duration_min=40
    result=result_for(case)
    assert len(result.schedule)==2 and all(s.rest_after_min==0 for s in result.schedule)
    assert result.schedule[0].end.strftime('%H:%M')=='12:40'
    assert result.schedule[1].start.strftime('%H:%M')=='13:30'
    assert result.metrics.approved_min==70 and result.metrics.free_capacity_min==50


def test_break_can_cause_a_reduction_without_becoming_a_saved_minute():
    case=case_for(budget=60)
    result=result_for(case)
    assert result.metrics.approved_min==45 and result.metrics.minutes_recovered==15
    assert result.metrics.pending_min==0 and result.metrics.free_capacity_min==5
    assert sum(s.rest_after_min for s in result.schedule)==10
    assert sum(d.saved_min for d in result.decisions)==15


@pytest.mark.parametrize('budget,kept',[(40,False),(45,True)])
def test_refill_reserves_the_break_as_well_as_the_minimum_work(budget,kept):
    case=case_for(budget=budget)
    case.tasks[0].mandatory=True;case.tasks[0].allow_reduction=False;case.tasks[0].minimum_min=30
    case.tasks[1].minimum_min=5
    result=result_for(case,dismissed={'b'})
    decision=result.decisions[1]
    assert (decision.verdict!='DISMISSED') is kept
    assert result.metrics.pending_min==0
    if kept:
        assert decision.approved_min==5 and result.metrics.free_capacity_min==0
    else:
        assert result.metrics.free_capacity_min==10


def test_slot_includes_before_buffer_work_and_after_rest():
    case=case_for();case.tasks[0].buffer_min=5
    result=result_for(case)
    first=result.schedule[0]
    assert first.buffer_min==5 and first.rest_after_min==10
    assert (first.end-first.start).total_seconds()==45*60
    assert result.metrics.approved_min==65 and result.metrics.free_capacity_min==45


def test_deadline_applies_to_work_finish_and_dependency_waits_for_rest_end():
    case=case_for();case.tasks[0].deadline=case.constitution.start+timedelta(minutes=30)
    case.tasks[0].mandatory=True;case.tasks[1].depends_on=['a']
    result=result_for(case)
    a,b=result.schedule
    assert a.end==case.constitution.start+timedelta(minutes=40)
    assert b.start==a.end and a.rest_after_min==10 and b.rest_after_min==0
    verify_result(case,result)


def test_mandatory_work_conflicts_instead_of_losing_a_required_break():
    case=case_for(budget=60)
    for task in case.tasks:
        task.mandatory=True;task.allow_reduction=False;task.minimum_min=30
    result=result_for(case)
    assert result.status=='conflict' and result.metrics.pending_min==30
    assert sum(d.approved_min for d in result.decisions)==60
    assert len(result.schedule)==1 and result.schedule[0].rest_after_min==0


def test_tampered_rest_is_rejected_by_independent_verification():
    case=case_for();result=result_for(case)
    result.schedule[0].rest_after_min=0
    with pytest.raises(ValueError):verify_result(case,result)


@pytest.mark.parametrize('value',[-1,1441,True,'10',1.5])
def test_break_input_is_a_bounded_strict_integer(value):
    data=case_for().constitution.model_dump(mode='json');data['break_min']=value
    with pytest.raises(ValidationError):Constitution.model_validate(data)


def test_zero_default_is_omitted_for_legacy_fingerprints_and_fixtures():
    case=case_for(rest=0);result=result_for(case)
    assert 'break_min' not in case.constitution.model_dump()
    assert all('rest_after_min' not in slot.model_dump() for slot in result.schedule)
    assert result.metrics.approved_min==60 and result.metrics.free_capacity_min==60


def test_api_accepts_breaks_and_omits_zero_rest_without_changing_request_id_behavior(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.service import TrialService
    calls=[]
    class Provider:
        def __init__(self,settings):pass
        async def run(self,case):
            calls.append(case.constitution.break_min)
            return RunProposal(decisions=[fallback_recommendation(t) for t in case.tasks]),Meta()
    monkeypatch.setenv('TRIAL_MODE','live')
    monkeypatch.setattr(app.state,'service',TrialService(provider_factory=Provider))
    body=dict(request_id='break-api',confirmed=True,api_version='1',case=case_for().model_dump(mode='json'))
    with TestClient(app) as client:
        response=client.post('/api/trial/run',json=body,headers={'Origin':'http://localhost:3000'})
        assert response.status_code==200,response.text
        result=response.json()
        assert response.headers['access-control-allow-origin']=='http://localhost:3000'
        assert result['schedule'][0]['rest_after_min']==10 and 'rest_after_min' not in result['schedule'][-1]
        assert result['metrics']['approved_min']==60 and result['metrics']['free_capacity_min']==50
        assert client.post('/api/trial/run',json=body).json()==result and calls==[10]
        body['case']['constitution']['break_min']=0
        assert client.post('/api/trial/run',json=body).status_code==409


def test_init_preserves_the_requested_break_setting(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.service import TrialService
    monkeypatch.setenv('TRIAL_MODE','replay')
    monkeypatch.setattr(app.state,'service',TrialService())
    with TestClient(app) as client:
        response=client.post('/api/trial/init',json=dict(request_id='init-breaks',raw_text='Study 30 min',
            constitution=case_for().constitution.model_dump(mode='json')))
        assert response.status_code==200,response.text
        assert response.json()['case']['constitution']['break_min']==10


def test_randomized_break_schedules_conserve_work_and_physical_calendar_cost():
    rng=random.Random(17)
    for _ in range(30):
        case=case_for(budget=rng.choice([60,90,120]),rest=rng.choice([5,10,15]))
        case.tasks=[]
        from backend.schemas import Task
        for i in range(6):
            case.tasks.append(Task(id=f't{i}',title=f'Task {i}',duration_min=rng.choice([10,20,30]),
                minimum_min=5,buffer_min=rng.choice([0,5]),allow_reduction=True,category='health'))
        if rng.choice([True,False]):
            case.constitution.fixed_blocks=[FixedBlock(start=case.constitution.start+timedelta(minutes=45),
                end=case.constitution.start+timedelta(minutes=60),label='Lunch')]
        result=result_for(case)
        verify_result(case,result)
        assert result.metrics.approved_min+result.metrics.minutes_recovered==result.metrics.original_min
        assert result.metrics.free_capacity_min+sum(int((s.end-s.start).total_seconds()/60)
            for s in result.schedule)==min(case.budget_min,120-(15 if case.constitution.fixed_blocks else 0))
