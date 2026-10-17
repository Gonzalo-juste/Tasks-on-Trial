"""Confirmed budget and buffer-inclusive metric conservation."""
import pytest
from pydantic import ValidationError
from backend.schemas import Case, Meta, RunProposal, FixedBlock
from backend.scheduler import effective_budget
from backend.tribunal import build_result, fallback_recommendation
from backend.validation import verify_result


def budget_case(budget=90):
    return Case.model_validate(dict(budget_min=budget, tasks=[
        dict(id='work', title='Report', duration_min=60, minimum_min=15,
             category='work', buffer_min=20, allow_reduction=True, facts=['A draft is enough']),
        dict(id='leisure', title='Read', duration_min=45, minimum_min=15,
             category='leisure', buffer_min=10, facts=['This can wait']),
    ], constitution=dict(start='2026-10-17T09:00:00+01:00', end='2026-10-17T13:00:00+01:00',
                         priorities=['work', 'leisure'])))


def test_explicit_budget_limits_placement_even_in_a_long_calendar_window():
    case = budget_case()
    result = build_result(case, None, 'budget', 'fallback', Meta())
    assert result.metrics.model_dump() == dict(original_min=135, approved_min=135,
        minutes_recovered=0, pending_min=55, free_capacity_min=10)
    assert [slot.task_id for slot in result.schedule] == ['work']
    verify_result(case, result)


def test_dismissal_recovers_work_and_buffer_once():
    case = budget_case()
    rows = [fallback_recommendation(t) for t in case.tasks]
    rows[1].recommendation = 'DISMISSED'; rows[1].approved_min = 0
    rows[1].fact_cited = case.tasks[1].facts[0]
    result = build_result(case, RunProposal(decisions=rows), 'dismiss-buffer', 'live', Meta())
    assert result.decisions[1].original_min == 45  # Decision fields describe work.
    assert result.decisions[1].saved_min == 55
    assert result.metrics.original_min == 135 and result.metrics.approved_min == 80
    assert result.metrics.minutes_recovered == sum(d.saved_min for d in result.decisions) == 55
    changed = result.model_copy(deep=True); changed.decisions[1].saved_min = 45
    with pytest.raises(ValueError): verify_result(case, changed)


def test_reduction_does_not_recover_retained_buffer():
    case = budget_case(240)
    rows = [fallback_recommendation(t) for t in case.tasks]
    rows[0].recommendation = 'REDUCED'; rows[0].approved_min = 45
    rows[0].fact_cited = case.tasks[0].facts[0]
    result = build_result(case, RunProposal(decisions=rows), 'reduce-buffer', 'live', Meta())
    assert result.decisions[0].saved_min == 15
    assert result.metrics.approved_min == 120 and result.metrics.minutes_recovered == 15
    assert result.schedule[0].buffer_min == 20


def test_budget_is_capped_by_window_less_merged_commitments():
    case = budget_case(200)
    case.constitution.fixed_blocks = [
        FixedBlock(start='2026-10-17T10:00:00+01:00', end='2026-10-17T11:30:00+01:00'),
        FixedBlock(start='2026-10-17T11:00:00+01:00', end='2026-10-17T12:00:00+01:00')]
    assert effective_budget(case) == 120
    case.budget_min = 60
    assert effective_budget(case) == 60


def test_zero_budget_allocates_nothing_and_pending_is_not_savings():
    result = build_result(budget_case(0), None, 'zero', 'fallback', Meta())
    assert result.schedule == [] and result.metrics.free_capacity_min == 0
    assert result.metrics.pending_min == 135 and result.metrics.minutes_recovered == 0


@pytest.mark.parametrize('value', [-1, True, 45.5, '240', 1441])
def test_budget_requires_a_bounded_nonnegative_integer(value):
    with pytest.raises(ValidationError): budget_case(value)


def test_missing_budget_retains_calendar_capacity():
    case = budget_case(None)
    assert effective_budget(case) == 240
    result = build_result(case, None, 'no-explicit-budget', 'fallback', Meta())
    assert result.metrics.free_capacity_min == 105


def test_full_dismissal_can_recover_largest_work_and_buffer_values():
    case = budget_case(240)
    case.tasks = [case.tasks[1]]
    task = case.tasks[0]; task.duration_min = 1440; task.buffer_min = 1440
    row = fallback_recommendation(task)
    row.recommendation = 'DISMISSED'; row.approved_min = 0; row.fact_cited = task.facts[0]
    result = build_result(case, RunProposal(decisions=[row]), 'max-buffer', 'live', Meta())
    assert result.decisions[0].saved_min == 2880
    assert result.metrics.original_min == result.metrics.minutes_recovered == 2880
