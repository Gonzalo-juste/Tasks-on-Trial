"""Keep useful minimums and refill only when the real calendar can place them."""
from datetime import timedelta
import pytest

from backend.schemas import Case, FixedBlock, Meta, RunProposal
from backend.tribunal import build_result, decide, fallback_recommendation
from backend.validation import verify_result


def rehearsal_case(reducible_slides=False):
    return Case.model_validate(dict(budget_min=240,rules=dict(mode='quick',rounds=1),
        constitution=dict(start='2026-10-17T12:00:00+01:00',end='2026-10-17T16:00:00+01:00',
            priorities=['work','health','learning','leisure']),tasks=[
        dict(id='slides',title='Finish pitch slides',duration_min=90,minimum_min=70 if reducible_slides else 90,
            mandatory=True,allow_reduction=reducible_slides,category='work',deadline='2026-10-17T18:00:00+01:00',facts=['Due at 18:00']),
        dict(id='study',title='Study for exam',duration_min=90,minimum_min=90,mandatory=True,allow_reduction=False,category='learning',facts=['Study for exam 90 min']),
        dict(id='gym',title='Gym',duration_min=60,minimum_min=30,buffer_min=20,allow_reduction=True,category='health',facts=['Needs 20 minutes of travel or setup']),
        dict(id='run',title='Go for a run',duration_min=30,minimum_min=15,allow_reduction=True,category='health',facts=[]),
        dict(id='emails',title='Reply to emails',duration_min=30,minimum_min=10,allow_reduction=True,category='work',facts=['Between one and five emails need a reply today']),
        dict(id='tiktok',title='Scroll TikTok',duration_min=45,minimum_min=10,allow_reduction=True,category='leisure',facts=[])]))


def recommendations(case, dismiss=(), shorter=None):
    rows=[fallback_recommendation(t) for t in case.tasks]
    for row in rows:
        if row.task_id in dismiss:
            row.recommendation,row.approved_min='DISMISSED',0
        if row.task_id in (shorter or {}):
            row.approved_min=shorter[row.task_id]  # Reproduce the model's APPROVED + fewer minutes.
    return RunProposal(decisions=rows)


def test_rehearsal_235_target_requires_slides_shortening_permission():
    case=rehearsal_case(True)
    proposal=recommendations(case,{'gym','run','tiktok'},dict(slides=70,emails=10))
    result=build_result(case,proposal,'target-235','live',Meta())
    allocations={d.task_id:d.approved_min for d in result.decisions}
    assert allocations==dict(slides=70,study=90,gym=30,run=15,emails=10,tiktok=0)
    assert result.metrics.model_dump()==dict(original_min=365,approved_min=235,
        minutes_recovered=130,pending_min=0,free_capacity_min=5)
    verify_result(case,result)


def test_fixed_slides_cannot_be_silently_shortened_to_make_target_fit():
    case=rehearsal_case()
    result=build_result(case,recommendations(case,{'gym','run','tiktok'},dict(slides=70,emails=10)),
                        'locked-slides','live',Meta())
    by_id={d.task_id:d for d in result.decisions}
    assert by_id['slides'].approved_min==90 and by_id['study'].approved_min==90
    assert by_id['run'].approved_min==30 and by_id['emails'].approved_min==10
    assert by_id['gym'].verdict=='DISMISSED'  # Its 50-minute minimum cannot fit.
    assert result.metrics.approved_min==220 and result.metrics.pending_min==0


def test_run_is_refilled_when_exactly_30_minutes_are_spare():
    case=rehearsal_case()
    result=build_result(case,recommendations(case,{'gym','run','tiktok'}),'thirty-spare','live',Meta())
    run=next(d for d in result.decisions if d.task_id=='run')
    assert run.verdict=='APPROVED' and run.approved_min==30 and run.schedule_status=='SCHEDULED'
    assert result.metrics.free_capacity_min==0 and result.metrics.pending_min==0


@pytest.mark.parametrize('category',['work','health','learning','family','money'])
def test_legitimate_need_without_facts_is_reduced_instead_of_dismissed(category):
    case=rehearsal_case();value=case.tasks[3].model_copy(deep=True)
    value.category=category;case.tasks=[value];case.budget_min=15
    result=build_result(case,recommendations(case),'minimum-'+category,'live',Meta())
    assert result.decisions[0].verdict=='REDUCED' and result.decisions[0].approved_min==15
    assert 'not_proven' not in result.decisions[0].reason
    assert result.metrics.pending_min==0


def test_unsupported_leisure_stays_dismissed_instead_of_being_refilled():
    case=rehearsal_case();case.tasks=[case.tasks[-1]]
    result=build_result(case,recommendations(case,{'tiktok'}),'merits-dismissal','live',Meta())
    assert result.decisions[0].verdict=='DISMISSED' and result.metrics.free_capacity_min==240


def test_refill_does_not_expand_a_judges_valid_smaller_email_scope():
    case=rehearsal_case();case.tasks=[case.tasks[-2]]
    result=build_result(case,recommendations(case,shorter={'emails':10}),'keep-ten','live',Meta())
    assert result.decisions[0].approved_min==10 and result.decisions[0].verdict=='REDUCED'


@pytest.mark.parametrize('blocked_by',['buffer','deadline','fragmentation','dependency'])
def test_spare_minutes_do_not_override_calendar_constraints(blocked_by):
    case=rehearsal_case();value=case.tasks[3].model_copy(deep=True);case.tasks=[value]
    case.budget_min=30
    if blocked_by=='buffer':value.buffer_min=20
    if blocked_by=='deadline':value.deadline=case.constitution.start+timedelta(minutes=5)
    if blocked_by=='fragmentation':
        case.constitution.end=case.constitution.start+timedelta(hours=1)
        case.constitution.fixed_blocks=[FixedBlock(start=case.constitution.start+timedelta(minutes=i),
            end=case.constitution.start+timedelta(minutes=i+10)) for i in [10,30,50]]
    if blocked_by=='dependency':
        prerequisite=rehearsal_case().tasks[0];prerequisite.duration_min=prerequisite.minimum_min=30
        value.depends_on=['slides'];case.tasks.insert(0,prerequisite)
    result=build_result(case,recommendations(case,{'run'}),'blocked-'+blocked_by,'live',Meta())
    assert next(d for d in result.decisions if d.task_id=='run').verdict=='DISMISSED'
    verify_result(case,result)


def test_shorter_approved_label_cannot_bypass_permission_minimum_or_fact_provenance():
    value=rehearsal_case().tasks[-2]
    row=fallback_recommendation(value);row.approved_min=1
    assert decide(value,row).approved_min==10
    row.fact_cited='Invented evidence'
    assert decide(value,row).approved_min==30
    row.fact_cited=None;value.allow_reduction=False
    assert decide(value,row).approved_min==30
