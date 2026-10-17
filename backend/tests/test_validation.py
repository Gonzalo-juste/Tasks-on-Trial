from copy import deepcopy
from datetime import timedelta
import random
import pytest
from backend.schemas import RunRequest, TrialResult, Case, Constitution, Task, Meta
from backend.service import fixture
from backend.tribunal import build_result, normalize_plan, make_proposal
from backend.schemas import Replacement
from backend.validation import verify_result

@pytest.mark.parametrize('name',['run.response.json','appeal.response.json'])
def test_shared_fixtures_pass_independent_validation(name):
    case=RunRequest.model_validate(fixture('run.request.json')).case
    verify_result(case,TrialResult.model_validate(fixture(name)))

@pytest.mark.parametrize('kind',['saved','plan','metric','first_move','release','original','duplicate','conflict'])
def test_corrupted_result_is_rejected(kind):
    case=RunRequest.model_validate(fixture('run.request.json')).case
    result=TrialResult.model_validate(fixture('run.response.json'))
    if kind=='saved':result.decisions[0].saved_min=10
    if kind=='plan':result.decisions[0].action_plan[0].minutes=1
    if kind=='metric':result.metrics.free_capacity_min=0
    if kind=='first_move':result.decisions[0].first_move=None
    if kind=='release':result.decisions[-1].release=None
    if kind=='original':result.decisions[0].original_min=121
    if kind=='duplicate':result.decisions.append(result.decisions[0])
    if kind=='conflict':result.status='conflict'
    with pytest.raises(ValueError):verify_result(case,result)


def test_long_accepted_title_does_not_break_fallback_orders():
    title='A'*500
    plan=normalize_plan([],15,title)
    assert len(plan[0].step)<=500
    task=RunRequest.model_validate(fixture('run.request.json')).case.tasks[-1]
    proposal=make_proposal(task,Replacement(title=title,duration_min=15))
    assert len(proposal.first_move)<=500 and len(proposal.done_when)<=500
    assert sum(s.minutes for s in proposal.action_plan)==15


def test_seeded_scheduler_cases_conserve_minutes_and_constraints():
    """120 varied valid inputs with DAGs, merged blocks, deadlines and short windows."""
    rng=random.Random(17026)
    base=RunRequest.model_validate(fixture('run.request.json')).case.constitution
    for iteration in range(120):
        constitution=base.model_copy(deep=True)
        constitution.end=constitution.start+timedelta(minutes=rng.randint(1,9)*60)
        constitution.fixed_blocks=[b for b in constitution.fixed_blocks if b.end<=constitution.end]
        tasks=[]
        for i in range(rng.randint(1,6)):
            tasks.append(Task(id=f't{i}',title=f'Task {i}',duration_min=rng.randint(1,180),minimum_min=1,
                mandatory=rng.choice([True,False]),category=rng.choice(['health','work','leisure']),
                deadline=(constitution.start+timedelta(minutes=rng.randint(1,540))) if rng.choice([True,False]) else None,
                depends_on=[t.id for t in tasks if rng.random()<0.2]))
        case=Case(tasks=tasks,constitution=constitution)
        result=build_result(case,None,f'fuzz-{iteration}','fallback',Meta())
        verify_result(case,result)
        assert result.metrics.minutes_recovered==0
        assert result.metrics.approved_min==result.metrics.pending_min+sum(d.approved_min for d in result.decisions if d.schedule_status=='SCHEDULED')


def test_unknown_schedule_task_is_rejected():
    case=RunRequest.model_validate(fixture('run.request.json')).case
    result=TrialResult.model_validate(fixture('run.response.json'))
    result.schedule[0].task_id='unknown'
    with pytest.raises(ValueError,match='Unknown schedule'):
        verify_result(case,result)
