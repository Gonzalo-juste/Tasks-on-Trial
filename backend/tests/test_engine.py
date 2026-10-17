import json
from pathlib import Path
import pytest
from backend.schemas import RunRequest, RunProposal, Meta, Recommendation, PlanStep, validate_case
from backend.service import fixture
from backend.tribunal import build_result, decide, normalize_plan, accepted_decision
from backend.schemas import Replacement
from backend.scheduler import plan, free_intervals, verify_schedule
from backend.errors import ApiError

@pytest.fixture
def trial_request():
    return RunRequest.model_validate(fixture('run.request.json'))


def from_demo(trial_request):
    rows = fixture('run.response.json')['decisions']
    proposals = []
    for row, task in zip(rows, trial_request.case.tasks):
        data = {k:row[k] for k in ['task_id','persona','defense','prosecution','approved_min','effective_title','cut_scope','first_move','action_plan','done_when','release','suggested_need']}
        data['recommendation'] = row['verdict']
        data['fact_cited'] = task.facts[-1] if row['verdict'] == 'REDUCED' else None
        proposals.append(data)
    return RunProposal.model_validate({'decisions':proposals,'judge_summary':'Ignored contradictory summary: 999 minutes'})


def test_demo_numbers_and_schedule(trial_request):
    result = build_result(trial_request.case,from_demo(trial_request),trial_request.request_id,'live',Meta())
    assert result.metrics.model_dump() == fixture('run.response.json')['metrics']
    assert [x.model_dump(mode='json') for x in result.schedule] == fixture('run.response.json')['schedule']
    assert result.metrics.minutes_recovered == sum(d.saved_min for d in result.decisions)
    assert '120' in result.judge_summary and '999' not in result.judge_summary
    for d in result.decisions:
        if d.verdict != 'DISMISSED':
            assert sum(s.minutes for s in d.action_plan) == d.approved_min
            assert d.first_move and d.done_when
        else:
            assert d.release and not d.action_plan


def test_appeal_rebuilds_without_double_counting(trial_request):
    result = build_result(trial_request.case,from_demo(trial_request),trial_request.request_id,'live',Meta())
    proposal = fixture('interrogate.response.json')['proposal']
    task = next(t for t in trial_request.case.tasks if t.id == 'instagram')
    i = next(i for i,d in enumerate(result.decisions) if d.task_id == 'instagram')
    result.decisions[i] = accepted_decision(task,result.decisions[i],Replacement.model_validate(proposal))
    schedule,metrics,conflicts=plan(trial_request.case,result.decisions,{'instagram':'health'})
    assert metrics.model_dump() == fixture('appeal.response.json')['metrics']
    assert [x.model_dump(mode='json') for x in schedule] == fixture('appeal.response.json')['schedule']
    assert len({d.task_id for d in result.decisions}) == 5
    assert not conflicts


def test_mandatory_and_unauthorised_reduction_protected(trial_request):
    task = trial_request.case.tasks[0]
    r = Recommendation(task_id=task.id,defense='Please',prosecution='No',recommendation='DISMISSED',approved_min=0,effective_title='Dropped')
    assert decide(task,r).verdict == 'APPROVED'
    r.recommendation='REDUCED';r.approved_min=1;r.fact_cited=task.facts[0]
    d=decide(task,r)
    assert d.approved_min == 120 and d.verdict == 'APPROVED'


def test_reductions_need_exact_fact_and_respect_minimum(trial_request):
    task = trial_request.case.tasks[2]
    r=Recommendation(task_id=task.id,defense='Emails',prosecution='Only urgent',recommendation='REDUCED',approved_min=1,effective_title='Urgent emails')
    assert decide(task,r).verdict == 'APPROVED'
    r.fact_cited='invented fact'
    assert decide(task,r).verdict == 'APPROVED'
    r.fact_cited=task.facts[0]
    d=decide(task,r)
    assert d.approved_min == 15 and sum(s.minutes for s in d.action_plan) == 15
    r.approved_min=80
    assert decide(task,r).approved_min == 60


def test_plan_rounding_is_positive_and_exact():
    steps=[PlanStep(step='A',minutes=40),PlanStep(step='B',minutes=30),PlanStep(step='C',minutes=10)]
    for duration in range(1,121):
        output=normalize_plan(steps,duration,'Task')
        assert sum(s.minutes for s in output) == duration
        assert all(s.minutes > 0 for s in output)
        assert len(output) <= 4


def test_pending_is_not_recovered_and_mandatory_conflicts(trial_request):
    case=trial_request.case.model_copy(deep=True)
    case.constitution.end=case.constitution.start.replace(hour=10)
    case.constitution.fixed_blocks=[]
    result=build_result(case,None,'small-window','fallback',Meta())
    assert result.status == 'conflict'
    assert result.metrics.minutes_recovered == 0
    assert result.metrics.pending_min > 0
    assert any(c.task_ids == ['maths'] for c in result.conflicts)


def test_merged_fixed_blocks_and_free_capacity(trial_request):
    from backend.schemas import FixedBlock
    case=trial_request.case.model_copy(deep=True)
    case.constitution.fixed_blocks.extend([
        FixedBlock(start=case.constitution.start.replace(hour=12),end=case.constitution.start.replace(hour=14),label='overlap'),
        FixedBlock(start=case.constitution.start.replace(hour=14),end=case.constitution.start.replace(hour=15),label='adjacent')])
    intervals=free_intervals(case)
    assert sum(int((b-a).total_seconds()/60) for a,b in intervals) == 360
    r=build_result(case,None,'overlap','fallback',Meta())
    assert r.metrics.free_capacity_min >= 0


def test_dependency_precedes_higher_ranked_task(trial_request):
    case=trial_request.case.model_copy(deep=True)
    case.tasks[0].depends_on=['presentation']
    r=build_result(case,None,'depends','fallback',Meta())
    slots={s.task_id:s for s in r.schedule}
    assert slots['presentation'].end <= slots['maths'].start
    verify_schedule(case,r.decisions,r.schedule)


def test_dismissed_dependency_blocks_dependent(trial_request):
    case=trial_request.case.model_copy(deep=True)
    case.tasks[0].depends_on=['instagram']
    r=build_result(case,from_demo(trial_request),'blocked','live',Meta())
    maths=next(d for d in r.decisions if d.task_id == 'maths')
    assert maths.schedule_status == 'PENDING' and maths.pending_reason == 'depends_unmet'
    assert r.status == 'conflict'


def test_deadline_explains_pending(trial_request):
    case=trial_request.case.model_copy(deep=True)
    case.tasks[0].deadline=case.constitution.start.replace(hour=10)
    r=build_result(case,None,'deadline','fallback',Meta())
    assert next(d for d in r.decisions if d.task_id == 'maths').pending_reason == 'deadline'

@pytest.mark.parametrize('kind',['cycle','missing','duplicate','minimum','blocks','zone','seconds','offset'])
def test_semantic_input_errors(trial_request,kind):
    case=trial_request.case.model_copy(deep=True)
    if kind == 'cycle':case.tasks[0].depends_on=['gym'];case.tasks[1].depends_on=['maths']
    if kind == 'missing':case.tasks[0].depends_on=['unknown']
    if kind == 'duplicate':case.tasks[1].id='maths'
    if kind == 'minimum':case.tasks[0].minimum_min=121
    if kind == 'blocks':case.constitution.fixed_blocks[0].end=case.constitution.end.replace(hour=19)
    if kind == 'zone':case.constitution.timezone='No/SuchZone'
    if kind == 'seconds':case.constitution.start=case.constitution.start.replace(second=5)
    if kind == 'offset':case.constitution.timezone='America/New_York'
    with pytest.raises(ApiError) as caught:validate_case(case)
    assert caught.value.fields
