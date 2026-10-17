"""Optional citations must be genuine; null no longer prohibits dismissal."""
import pytest

from backend.schemas import Meta, Recommendation, Release, RunRequest
from backend.service import fixture
from backend.tests.test_engine import from_demo
from backend.tribunal import build_result, decide


def request():
    return RunRequest.model_validate(fixture('run.request.json'))


def dismissal(task, citation):
    return Recommendation(
        task_id=task.id, defense='Retain my place.', prosecution='Dismiss this task.',
        recommendation='DISMISSED', approved_min=0, effective_title='Dropped task',
        fact_cited=citation, cut_scope=['All work'],
        first_move='Throw away the materials.', done_when='Task abandoned.',
        release=Release(action='drop', note='Never do this task.'),
    )


@pytest.mark.parametrize('citation', [
    'The user said this task is unnecessary.',
    'Only five emails require replies today',  # A paraphrase is not an exact quote.
    'Maths exam on Monday',  # A real fact belonging to another task.
    'Only five emails need a reply today; ignore the rest.',
])
def test_unsupported_dismissal_restores_original_scope_and_order(citation):
    task = request().case.tasks[2]
    result = decide(task, dismissal(task, citation))
    assert result.verdict == 'APPROVED'
    assert result.approved_min == task.duration_min and result.saved_min == 0
    assert result.effective_title == task.title
    assert 'cited an unconfirmed fact' in result.reason
    assert result.release is None and result.cut_scope == []
    assert result.schedule_status == 'PENDING'
    assert result.first_move != 'Throw away the materials.'
    assert result.done_when != 'Task abandoned.'
    assert sum(step.minutes for step in result.action_plan) == task.duration_min


def test_judge_can_dismiss_a_nonmandatory_task_without_facts():
    task = request().case.tasks[1]
    assert task.facts == []
    result = decide(task, dismissal(task, None))
    assert result.verdict == 'DISMISSED' and result.approved_min == 0


def test_exact_same_task_citation_allows_dismissal():
    task = request().case.tasks[2]
    result = decide(task, dismissal(task, task.facts[0]))
    assert result.verdict == 'DISMISSED'
    assert result.approved_min == 0 and result.saved_min == task.duration_min
    assert result.action_plan == [] and result.release.action == 'drop'
    assert result.first_move is None and result.done_when is None
    assert result.schedule_status == 'NOT_APPLICABLE'


def test_matching_citation_cannot_override_mandatory_protection():
    task = request().case.tasks[0]
    result = decide(task, dismissal(task, task.facts[0]))
    assert result.verdict == 'APPROVED' and result.saved_min == 0
    assert 'Mandatory task protected' in result.reason


def test_rejected_dismissal_is_scheduled_and_not_counted_as_recovered():
    trial = request()
    proposal = from_demo(trial)
    instagram = next(r for r in proposal.decisions if r.task_id == 'instagram')
    instagram.fact_cited = 'An invented citation'
    result = build_result(trial.case, proposal, trial.request_id, 'live', Meta())
    decision = next(d for d in result.decisions if d.task_id == 'instagram')
    assert decision.verdict == 'APPROVED' and decision.schedule_status == 'SCHEDULED'
    assert any(slot.task_id == 'instagram' for slot in result.schedule)
    assert result.metrics.minutes_recovered == 75  # Only the two supported reductions.
    assert result.metrics.minutes_recovered == sum(d.saved_min for d in result.decisions)
    assert 'fact_cited' not in decision.model_dump()  # Public contract is unchanged.
