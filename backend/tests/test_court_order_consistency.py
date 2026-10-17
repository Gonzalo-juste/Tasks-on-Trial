"""Regression cases for improvement 1: text and time must change together."""
import pytest
from backend.schemas import RunRequest, Recommendation, PlanStep, Replacement, TrialResult
from backend.service import fixture
from backend.tribunal import decide, make_proposal, accepted_decision, normalize_plan


def emails():
    return next(t for t in RunRequest.model_validate(fixture('run.request.json')).case.tasks if t.id == 'emails')


def recommendation(minutes, steps, verdict='REDUCED'):
    task=emails()
    return Recommendation(task_id=task.id, defense='Only urgent replies are needed.',
        prosecution='Limit the scope to urgent replies.', recommendation=verdict,
        approved_min=minutes, effective_title='Urgent replies', fact_cited=task.facts[0],
        first_move='Start the obsolete one-minute timer.', action_plan=steps,
        done_when='The obsolete one-minute timer ends.')


def assert_safe_order(value, minutes):
    assert value.first_move == 'Prepare the materials needed for the approved task scope.'
    assert value.done_when == 'The approved task scope is completed.'
    assert [(s.step,s.minutes) for s in value.action_plan] == [('Work on the approved task scope',minutes)]


@pytest.mark.parametrize('steps',[
    [PlanStep(step='Reply for one minute',minutes=1)],
    # Even a numerically balanced plan must be replaced if the proposed duration changed.
    [PlanStep(step='Finish after the one-minute timer',minutes=15)],
])
def test_minimum_clamp_replaces_all_time_dependent_wording(steps):
    d=decide(emails(),recommendation(1,steps))
    assert d.verdict=='REDUCED' and d.approved_min==15 and d.saved_min==45
    assert d.effective_title=='Urgent replies'
    assert_safe_order(d,15)


@pytest.mark.parametrize('verdict,minutes', [('APPROVED',60),('REDUCED',15)])
def test_wrong_step_total_replaces_plan_starter_and_finish(verdict,minutes):
    d=decide(emails(),recommendation(minutes,[PlanStep(step='Reply for one minute',minutes=1)],verdict))
    assert d.approved_min==minutes and d.verdict==verdict
    assert_safe_order(d,minutes)


def test_missing_plan_does_not_reuse_orphaned_duration_instructions():
    d=decide(emails(),recommendation(15,[]))
    assert_safe_order(d,15)


def test_balanced_order_preserves_specific_instructions_and_steps():
    r=recommendation(15,[PlanStep(step='Select the urgent messages',minutes=3),
                         PlanStep(step='Send the five urgent replies',minutes=12)])
    r.first_move='Open the inbox and select the urgent messages.'
    r.done_when='The five urgent replies have been sent.'
    d=decide(emails(),r)
    assert d.first_move==r.first_move and d.done_when==r.done_when
    assert d.action_plan==r.action_plan
    d.action_plan[0].step='A local display edit'
    assert r.action_plan[0].step=='Select the urgent messages'


def test_interrogation_and_accepted_appeal_use_the_same_safe_order():
    task=emails()
    old=next(d for d in TrialResult.model_validate(fixture('run.response.json')).decisions if d.task_id==task.id)
    replacement=Replacement(title='Urgent replies',duration_min=15,
        first_move='Start the obsolete one-minute timer.',
        action_plan=[PlanStep(step='Reply for one minute',minutes=1)],
        done_when='The obsolete one-minute timer ends.')
    proposal=make_proposal(task,replacement)
    accepted=accepted_decision(task,old,replacement)
    assert_safe_order(proposal,15)
    assert_safe_order(accepted,15)
    assert proposal.action_plan==accepted.action_plan
    assert accepted.original_min==60 and accepted.saved_min==45


def test_compatible_accepted_replacement_is_preserved():
    task=emails()
    old=next(d for d in TrialResult.model_validate(fixture('run.response.json')).decisions if d.task_id==task.id)
    replacement=Replacement(title='Urgent replies',duration_min=15,
        first_move='Open the urgent folder.',
        action_plan=[PlanStep(step='Reply to urgent messages',minutes=15)],
        done_when='The five urgent replies have been sent.')
    d=accepted_decision(task,old,replacement)
    assert d.first_move==replacement.first_move and d.done_when==replacement.done_when
    assert d.action_plan==replacement.action_plan


def test_normalizer_does_not_copy_obsolete_time_from_title():
    result=normalize_plan([PlanStep(step='Use the one-minute timer',minutes=1)],15,'One-minute urgent replies')
    assert [(s.step,s.minutes) for s in result]==[('Work on the approved task scope',15)]


def test_dismissed_orders_remain_empty():
    r=recommendation(0,[PlanStep(step='An irrelevant timed plan',minutes=1)],'DISMISSED')
    d=decide(emails(),r)
    assert d.approved_min==0 and d.first_move is None and d.done_when is None
    assert d.action_plan==[] and d.release is not None
