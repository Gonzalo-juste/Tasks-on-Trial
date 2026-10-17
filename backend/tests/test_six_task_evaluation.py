"""Synthetic six-task evaluation: engine coverage, not provider quality."""
from datetime import datetime

import pytest

from backend.schemas import Case, Meta, RunProposal, TrialResult, validate_case
from backend.tribunal import build_result, fallback_recommendation


def at(clock):
    return datetime.fromisoformat(f'2026-10-17T{clock}:00+01:00')


@pytest.fixture(params=['en', 'es'])
def six_tasks(request):
    spanish = request.param == 'es'
    titles = (['Preparar informe', 'Responder mensajes', 'Pasear', 'Leer por placer',
               'Cuidar a un familiar', 'Estudiar francés'] if spanish else
              ['Prepare report', 'Answer messages', 'Take a walk', 'Read for pleasure',
               'Care for a relative', 'Study French'])
    facts = (['Los gráficos decorativos son opcionales', 'Solo tres mensajes son urgentes',
              'Prefiero pasear al aire libre', 'Quiero leer por placer',
              'He confirmado esta visita', 'Quiero practicar la pronunciación'] if spanish else
             ['Decorative charts are optional', 'Only three messages are urgent',
              'I prefer walking outdoors', 'I want to read for pleasure',
              'I confirmed this visit', 'I want to practise pronunciation'])
    specs = [('report', 90, 45, 'work', True, True),
             ('admin', 45, 15, 'work', False, True),
             ('walk', 30, 30, 'health', False, False),
             ('leisure', 45, 30, 'leisure', False, True),
             ('care', 30, 30, 'family', True, False),
             ('learning', 60, 30, 'learning', False, False)]
    case = Case.model_validate({
        'tasks': [dict(id=i, title=title, duration_min=duration, minimum_min=minimum,
                       category=category, mandatory=mandatory, allow_reduction=reducible,
                       facts=[fact])
                  for (i, duration, minimum, category, mandatory, reducible), title, fact
                  in zip(specs, titles, facts)],
        'constitution': dict(timezone='Europe/London', start=at('09:00'), end=at('17:00'),
                             fixed_blocks=[dict(start=at('12:00'), end=at('13:00'), label='Lunch')],
                             priorities=['work', 'health', 'family', 'learning', 'leisure']),
    })
    return case


def evaluate(case, proposal=None):
    validate_case(case)
    result = build_result(case, proposal, 'synthetic-six', 'fallback' if proposal is None else 'live', Meta())
    # Test the returned public representation as well as the internal objects.
    assert TrialResult.model_validate_json(result.model_dump_json()) == result
    assert len(result.decisions) == 6
    assert {d.task_id for d in result.decisions} == {t.id for t in case.tasks}
    scheduled = sum(int((s.end-s.start).total_seconds()/60) for s in result.schedule)
    assert scheduled + result.metrics.pending_min == result.metrics.approved_min
    assert result.metrics.original_min == 300
    assert result.metrics.approved_min + result.metrics.minutes_recovered == 300
    assert sum(d.saved_min for d in result.decisions) == result.metrics.minutes_recovered
    for left, right in zip(result.schedule, result.schedule[1:]):
        assert left.end <= right.start
    for slot in result.schedule:
        assert case.constitution.start <= slot.start < slot.end <= case.constitution.end
        assert all(slot.end <= block.start or slot.start >= block.end
                   for block in case.constitution.fixed_blocks)
    for decision in result.decisions:
        if decision.verdict != 'DISMISSED':
            assert sum(step.minutes for step in decision.action_plan) == decision.approved_min
    return result


def test_six_task_baseline_preserves_text_and_all_confirmed_scope(six_tasks):
    result = evaluate(six_tasks)
    assert result.status == 'ok' and len(result.schedule) == 6
    assert result.metrics.approved_min == 300
    assert result.metrics.minutes_recovered == 0 and result.metrics.free_capacity_min == 120
    assert [d.effective_title for d in result.decisions] == [t.title for t in six_tasks.tasks]


def test_six_task_mixed_proposals_preserve_protected_scope(six_tasks):
    rows = [fallback_recommendation(t) for t in six_tasks.tasks]
    for index, minutes in [(0, 60), (1, 15), (5, 30)]:
        rows[index].recommendation = 'REDUCED'
        rows[index].approved_min = minutes
        rows[index].fact_cited = six_tasks.tasks[index].facts[0]
    for index in [3, 4]:
        rows[index].recommendation = 'DISMISSED'
        rows[index].approved_min = 0
    rows[4].fact_cited = six_tasks.tasks[4].facts[0]
    rows[3].fact_cited = 'An invented citation'
    result = evaluate(six_tasks, RunProposal(decisions=rows))
    decisions = {d.task_id: d for d in result.decisions}
    assert result.metrics.approved_min == 240 and result.metrics.minutes_recovered == 60
    assert result.metrics.free_capacity_min == 180
    assert decisions['report'].approved_min == 60
    assert decisions['admin'].approved_min == 15
    # An invented citation, mandatory status and no reduction permission protect these tasks.
    for task_id, minutes in [('leisure', 45), ('care', 30), ('learning', 60)]:
        assert decisions[task_id].verdict == 'APPROVED'
        assert decisions[task_id].approved_min == minutes


def test_competing_mandatory_deadlines_expose_conflict_without_fake_savings(six_tasks):
    six_tasks.tasks[0].deadline = at('10:00')
    six_tasks.tasks[4].deadline = at('10:00')
    result = evaluate(six_tasks)
    report = next(d for d in result.decisions if d.task_id == 'report')
    assert report.schedule_status == 'PENDING' and report.pending_reason == 'deadline'
    assert report.approved_min == 90 and report.saved_min == 0
    assert result.status == 'conflict' and result.metrics.pending_min == 90
    assert result.metrics.minutes_recovered == 0
    assert any('report' in conflict.task_ids for conflict in result.conflicts)
    assert all(slot.end <= at('10:00') for slot in result.schedule if slot.task_id == 'care')


def test_mandatory_leisure_gets_time_even_with_work_ranked_first(six_tasks):
    six_tasks.constitution.end = at('10:30')
    six_tasks.constitution.fixed_blocks = []
    six_tasks.tasks[0].mandatory = False
    six_tasks.tasks[3].mandatory = True
    result = evaluate(six_tasks)
    assert {s.task_id for s in result.schedule} == {'care', 'leisure'}
    assert result.metrics.pending_min == 225 and result.metrics.free_capacity_min == 15
    assert result.metrics.minutes_recovered == 0 and result.status == 'ok'
    assert all(d.verdict == 'APPROVED' for d in result.decisions)


def test_exact_deadline_finish_is_valid(six_tasks):
    six_tasks.tasks[0].deadline = at('10:30')
    result = evaluate(six_tasks)
    slot = next(s for s in result.schedule if s.task_id == 'report')
    assert slot.start == at('09:00') and slot.end == at('10:30')
    assert result.status == 'ok' and result.metrics.pending_min == 0


def test_six_task_dependency_order_survives_fixed_break(six_tasks):
    six_tasks.tasks[0].depends_on = ['learning']
    six_tasks.constitution.fixed_blocks[0].start = at('10:00')
    six_tasks.constitution.fixed_blocks[0].end = at('11:00')
    result = evaluate(six_tasks)
    slots = {s.task_id: s for s in result.schedule}
    assert slots['learning'].end == at('10:00')
    assert slots['report'].start == at('11:00')
    assert slots['learning'].end <= slots['report'].start
    assert result.metrics.pending_min == 0 and result.metrics.free_capacity_min == 120
