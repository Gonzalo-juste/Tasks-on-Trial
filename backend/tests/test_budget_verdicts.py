"""Judge-first allocation, followed only when necessary by explicit budget cuts."""
import pytest
from backend.schemas import Case, Meta, RunProposal
from backend.tribunal import build_result, fallback_recommendation
from backend.validation import verify_result


def chaotic_case():
    return Case.model_validate(dict(budget_min=240, tasks=[
        dict(id='slides', title='Finish pitch slides', duration_min=90, minimum_min=60,
             category='work', mandatory=True, allow_reduction=False, facts=['Due at 18:00']),
        dict(id='emails', title='Reply to emails', duration_min=30, minimum_min=10,
             category='work', allow_reduction=True, facts=[]),
        dict(id='study', title='Study for exam', duration_min=90, minimum_min=45,
             category='learning', allow_reduction=True, facts=['45 focused minutes would be enough today']),
        dict(id='gym', title='Gym', duration_min=60, minimum_min=30,
             category='health', allow_reduction=True, buffer_min=20, facts=['Needs 20 minutes of travel']),
        dict(id='tiktok', title='Scroll TikTok', duration_min=45, minimum_min=10,
             category='leisure', allow_reduction=True, facts=[]),
    ], constitution=dict(start='2026-10-17T12:00:00+01:00', end='2026-10-17T16:00:00+01:00',
                         priorities=['work', 'learning', 'health', 'leisure'])))


def recommendations(case):
    return RunProposal(decisions=[fallback_recommendation(t) for t in case.tasks])


def assert_valid(case, result):
    verify_result(case, result)
    assert result.metrics.approved_min == result.metrics.pending_min + sum(
        int((slot.end-slot.start).total_seconds()/60) for slot in result.schedule)
    assert result.metrics.minutes_recovered == sum(d.saved_min for d in result.decisions)
    for decision in result.decisions:
        if decision.verdict != 'DISMISSED':
            assert sum(s.minutes for s in decision.action_plan) == decision.approved_min


def test_judge_allocation_225_is_kept_without_python_cuts():
    case = chaotic_case(); proposal = recommendations(case)
    by_id = {d.task_id:d for d in proposal.decisions}
    by_id['emails'].recommendation = 'REDUCED'; by_id['emails'].approved_min = 10
    by_id['study'].recommendation = 'REDUCED'; by_id['study'].approved_min = 45
    by_id['tiktok'].recommendation = 'DISMISSED'; by_id['tiktok'].approved_min = 0
    result = build_result(case, proposal, 'judge-first', 'live', Meta())
    assert result.metrics.model_dump() == dict(original_min=335, approved_min=225,
        minutes_recovered=110, pending_min=0, free_capacity_min=15)
    assert [d.verdict for d in result.decisions] == ['APPROVED','REDUCED','REDUCED','APPROVED','DISMISSED']
    assert not any('not_proven' in d.reason or 'budget_reduction' in d.reason for d in result.decisions)
    assert_valid(case, result)


@pytest.mark.parametrize('explicit_budget', [True, False])
def test_python_reduces_legitimate_needs_before_dismissal(explicit_budget):
    case = chaotic_case()
    if not explicit_budget: case.budget_min = None
    proposal = recommendations(case); before = proposal.model_dump()
    result = build_result(case, proposal, 'python-cuts', 'live', Meta())
    decisions = {d.task_id:d for d in result.decisions}
    assert result.metrics.model_dump() == dict(original_min=335, approved_min=240,
        minutes_recovered=95, pending_min=0, free_capacity_min=0)
    assert decisions['tiktok'].verdict == 'DISMISSED' and 'not_proven' in decisions['tiktok'].reason
    assert decisions['gym'].verdict == 'REDUCED' and decisions['gym'].approved_min == 30
    assert decisions['study'].approved_min == 90
    assert decisions['emails'].verdict == 'REDUCED' and decisions['emails'].approved_min == 10
    assert 'travel' not in decisions['gym'].reason.lower()  # Need, not overhead, drives the reduction.
    assert proposal.model_dump() == before
    assert_valid(case, result)


def test_minimum_does_not_forbid_dismissal_and_buffer_is_recovered():
    case = chaotic_case(); case.tasks[-1].minimum_min = 45; case.tasks[-1].buffer_min = 15
    result = build_result(case, recommendations(case), 'minimum-not-protection', 'live', Meta())
    decision = next(d for d in result.decisions if d.task_id == 'tiktok')
    assert decision.verdict == 'DISMISSED' and decision.saved_min == 60
    assert not any(s.task_id == 'tiktok' for s in result.schedule)
    assert_valid(case, result)


def test_mandatory_only_over_budget_is_impossible_as_filed():
    case = chaotic_case(); case.budget_min = 60
    result = build_result(case, recommendations(case), 'impossible', 'live', Meta())
    slides = next(d for d in result.decisions if d.task_id == 'slides')
    assert slides.verdict == 'APPROVED' and slides.approved_min == 90
    assert slides.schedule_status == 'PENDING' and result.status == 'conflict'
    assert any(c.code == 'impossible_as_filed' and 'slides' in c.task_ids for c in result.conflicts)
    assert_valid(case, result)


def test_mandatory_without_facts_is_never_dismissed():
    case = chaotic_case(); case.tasks[0].facts = []; case.budget_min = 30
    proposal = recommendations(case)
    proposal.decisions[0].recommendation = 'DISMISSED'; proposal.decisions[0].approved_min = 0
    result = build_result(case, proposal, 'mandatory-no-facts', 'live', Meta())
    slides = result.decisions[0]
    assert slides.verdict == 'APPROVED' and slides.approved_min == 90
    assert result.status == 'conflict'
    assert_valid(case, result)


def test_no_reduction_permission_is_all_or_nothing_not_dismissal_protection():
    case = chaotic_case(); case.tasks[3].allow_reduction = False
    result = build_result(case, recommendations(case), 'no-gym-reduction', 'live', Meta())
    gym = next(d for d in result.decisions if d.task_id == 'gym')
    assert gym.verdict == 'APPROVED' and gym.approved_min == 60
    case.budget_min = 100
    result = build_result(case, recommendations(case), 'whole-gym-does-not-fit', 'live', Meta())
    assert next(d for d in result.decisions if d.task_id == 'gym').verdict == 'DISMISSED'
    assert_valid(case, result)


def test_cut_order_depends_on_priority_not_input_order():
    case = chaotic_case()
    first = build_result(case, recommendations(case), 'same', 'live', Meta())
    case.tasks.reverse()
    second = build_result(case, recommendations(case), 'same', 'live', Meta())
    assert {d.task_id:(d.verdict,d.approved_min) for d in first.decisions} == {
        d.task_id:(d.verdict,d.approved_min) for d in second.decisions}
    assert first.metrics == second.metrics and first.schedule == second.schedule


def test_python_does_not_discard_prerequisite_of_retained_mandatory_work():
    case = chaotic_case(); case.tasks[0].depends_on = ['tiktok']
    case.budget_min = 180
    result = build_result(case, recommendations(case), 'prerequisite', 'live', Meta())
    assert next(d for d in result.decisions if d.task_id == 'tiktok').verdict != 'DISMISSED'
    slots = {s.task_id:s for s in result.schedule}
    assert slots['tiktok'].end <= slots['slides'].start
    assert_valid(case, result)


def test_provider_failure_fallback_does_not_pretend_to_be_a_judgment():
    case = chaotic_case()
    result = build_result(case, None, 'fallback', 'fallback', Meta())
    assert all(d.verdict == 'APPROVED' for d in result.decisions)
    assert result.metrics.minutes_recovered == 0 and result.metrics.pending_min > 0
    assert_valid(case, result)
