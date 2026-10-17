"""v4 contract regressions. All provider interactions are mocked locally."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.intake import prepare
from backend.main import app
from backend.nebius_client import NebiusClient, ProviderFailure
from backend.schemas import (InitRequest, InitDraft, RunRequest, Meta, RevisedOrder,
                             DetailedStep, Rules)
from backend.service import TrialService, fixture
from backend.tests.test_api import previous, appeal_body
from backend.tests.test_engine import from_demo
from backend.tribunal import build_result, accepted_decision
from backend.schemas import Replacement
from backend.validation import verify_result


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('TRIAL_MODE', 'replay')
    monkeypatch.setattr(app.state, 'service', TrialService())
    with TestClient(app) as value:
        yield value


def init_body():
    return dict(request_id='init-v4', api_version='1',
                raw_text="Study maths for Monday's exam\nGym\nAnswer emails\nPrepare Monday presentation\nInstagram",
                constitution=fixture('run.request.json')['case']['constitution'])


def run(client):
    response = client.post('/api/trial/run', json=fixture('run.request.json'))
    assert response.status_code == 200, response.text
    return response.json()


def draft_for(request):
    result = prepare(request)
    return InitDraft.model_validate(dict(tasks=[dict(**task.model_dump(), source_line=line)
        for task, line in zip(result.case.tasks, request.raw_text.splitlines())],
        questions=[q.model_dump() for q in result.questions], relations=[]))


def test_init_fallback_has_realistic_estimates_and_echoed_constitution(client):
    body = init_body()
    response = client.post('/api/trial/init', json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['source'] == 'fallback'
    tasks = result['case']['tasks']
    assert [t['duration_min'] for t in tasks] == [120, 60, 30, 120, 45]
    assert sum(t['duration_min'] for t in tasks) == 375
    assert tasks[1]['buffer_min'] == 20 and tasks[0]['mandatory']
    assert all(t['deadline'] is None for t in tasks)
    assert [t['facts'] for t in tasks] == [[line] for line in body['raw_text'].splitlines()]
    assert result['case']['constitution'] == body['constitution']
    assert len(result['questions']) == 2
    gym_question = next(q for q in result['questions'] if q['task_id'] == tasks[1]['id'])
    assert gym_question['options'][0]['patch'] == {'buffer_min':20}
    assert gym_question['options'][1]['patch'] == {'buffer_min':0}
    assert all('duration_min' in result['estimated'][t['id']] for t in tasks)
    assert client.post('/api/trial/init', json=body).json() == result
    body['raw_text'] = 'Another task'
    assert client.post('/api/trial/init', json=body).status_code == 409


@pytest.mark.parametrize('text', ['', '  \n  ', '\n'.join(['Task']*7), 'x'*201])
def test_init_rejects_invalid_lines_before_provider(client, text):
    body = init_body(); body['raw_text'] = text
    assert client.post('/api/trial/init', json=body).status_code == 422


def test_init_explicit_spanish_duration_and_untrusted_fact(client):
    body = init_body(); body['raw_text'] = 'Gimnasio 45 minutos\nLeer 20 minutos'
    result = client.post('/api/trial/init', json=body).json()
    assert [t['duration_min'] for t in result['case']['tasks']] == [45, 20]
    # Options remain hypothetical; their facts are not inserted into the tasks.
    assert result['case']['tasks'][0]['facts'] == ['Gimnasio 45 minutos']


@pytest.mark.parametrize('text,expected', [('Gym 1.5 hours', 90), ('Leer 20m', 20), ('Work 1440 min', 1440)])
def test_explicit_duration_units(client, text, expected):
    body = init_body(); body['raw_text'] = text
    response = client.post('/api/trial/init', json=body)
    assert response.status_code == 200, response.text
    assert response.json()['case']['tasks'][0]['duration_min'] == expected


def test_init_live_ignores_invented_facts_and_deadlines(client, monkeypatch):
    monkeypatch.setenv('TRIAL_MODE', 'live')
    class Provider:
        def __init__(self, settings): pass
        async def init(self, request):
            draft = draft_for(request)
            draft.tasks[0].facts = ['The exam is tomorrow at nine.']
            draft.tasks[0].deadline = request.constitution.start
            return draft, Meta()
    app.state.service = TrialService(provider_factory=Provider)
    result = client.post('/api/trial/init', json=init_body()).json()
    assert result['source'] == 'live'
    task = result['case']['tasks'][0]
    assert task['facts'] == ["Study maths for Monday's exam"]
    assert task['deadline'] is None


@pytest.mark.parametrize('failure', ['provider', 'line', 'cycle', 'question'])
def test_init_unsafe_draft_falls_back(client, monkeypatch, failure):
    monkeypatch.setenv('TRIAL_MODE', 'live')
    class Provider:
        def __init__(self, settings): pass
        async def init(self, request):
            if failure == 'provider': raise ProviderFailure('test')
            draft = draft_for(request)
            if failure == 'line': draft.tasks[0].source_line = 'Invented task'
            if failure == 'cycle': draft.tasks[0].depends_on = [draft.tasks[0].id]
            if failure == 'question': draft.questions[0].task_id = 'unknown'
            return draft, Meta()
    app.state.service = TrialService(provider_factory=Provider)
    response = client.post('/api/trial/init', json=init_body())
    assert response.status_code == 200 and response.json()['source'] == 'fallback'


def v4_result():
    request = RunRequest.model_validate(fixture('run.request.json'))
    request.case.tasks[1].buffer_min = 20
    request.case.tasks[2].duration_min = 30
    result = build_result(request.case, from_demo(request), request.request_id, 'live', Meta())
    return request, result


def test_v4_demo_numbers_and_buffer_slot():
    request, result = v4_result()
    assert result.metrics.model_dump() == dict(original_min=375, approved_min=285,
        minutes_recovered=90, pending_min=0, free_capacity_min=175)
    clocks = [(s.task_id, s.start.strftime('%H:%M'), s.end.strftime('%H:%M'), s.buffer_min)
              for s in result.schedule]
    assert clocks == [('maths', '09:00', '11:00', 0), ('gym', '11:00', '12:20', 20),
                      ('emails', '12:20', '12:35', 0), ('presentation', '14:00', '15:30', 0)]
    decision = next(d for d in result.decisions if d.task_id == 'gym')
    assert sum(s.minutes for s in decision.action_plan) == 60  # Buffer is not work.
    changed = result.model_copy(deep=True); changed.schedule[1].buffer_min = 0
    with pytest.raises(ValueError): verify_result(request.case, changed)


def test_v4_appeal_numbers_keep_buffer_and_move_emails():
    request, result = v4_result()
    task = request.case.tasks[-1]
    result.decisions[-1] = accepted_decision(task, result.decisions[-1],
        Replacement.model_validate(fixture('interrogate.response.json')['proposal']))
    after = build_result(request.case, None, 'appeal-v4', 'fallback', Meta(),
        decisions=result.decisions, categories={'instagram':'health'}, revision=2, appeals_used=1)
    assert after.metrics.model_dump() == dict(original_min=375, approved_min=300,
        minutes_recovered=75, pending_min=0, free_capacity_min=160)
    slots = {s.task_id: s for s in after.schedule}
    assert slots['instagram'].start.strftime('%H:%M') == '12:20'
    assert slots['emails'].start.strftime('%H:%M') == '12:35'


def test_buffer_cannot_cross_break_or_deadline():
    request, _result = v4_result()
    request.case.tasks[1].deadline = request.case.constitution.start.replace(hour=10, minute=10)
    result = build_result(request.case, None, 'buffer-deadline', 'fallback', Meta())
    gym = next(d for d in result.decisions if d.task_id == 'gym')
    assert gym.schedule_status == 'PENDING' and gym.pending_reason == 'deadline'
    assert gym.approved_min == 60 and gym.saved_min == 0
    assert result.metrics.minutes_recovered == 0


def test_pardon_restores_scope_without_using_appeal_and_is_idempotent(client):
    old = run(client)
    body = dict(**previous(old, 'pardon-1'), pardon=True)
    response = client.post('/api/trial/appeal', json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    instagram = next(d for d in result['decisions'] if d['task_id'] == 'instagram')
    assert instagram['verdict'] == 'APPROVED' and instagram['approved_min'] == 45
    assert instagram['saved_min'] == 0 and instagram['release'] is None
    assert result['revision'] == 2 and result['appeals_used'] == 0
    assert result['change']['delta_minutes_recovered'] == -45
    assert client.post('/api/trial/appeal', json=body).json() == result
    assert client.post('/api/trial/appeal', json=appeal_body(result)).json()['appeals_used'] == 1


def test_pardon_works_after_appeal_and_limit_is_enforced(client):
    result = client.post('/api/trial/appeal', json=appeal_body(run(client))).json()
    for index in range(2):
        result = client.post('/api/trial/appeal', json=dict(**previous(result, f'pardon-{index}'), pardon=True)).json()
        assert result['appeals_used'] == 1
    response = client.post('/api/trial/appeal', json=dict(**previous(result, 'pardon-3'), pardon=True))
    assert response.status_code == 409 and response.json()['error']['code'] == 'PARDON_LIMIT'


def test_pardon_and_replacement_are_mutually_exclusive(client):
    body = appeal_body(run(client)); body['pardon'] = True
    assert client.post('/api/trial/appeal', json=body).status_code == 422


def test_pardoned_task_stays_pending_if_calendar_is_full(client, monkeypatch):
    monkeypatch.setenv('TRIAL_MODE', 'live')
    class Provider:
        def __init__(self, settings): pass
        async def run(self, case):
            request = RunRequest(request_id='local', confirmed=True, case=case)
            return from_demo(request), Meta()
    app.state.service = TrialService(provider_factory=Provider)
    body = fixture('run.request.json')
    body['case']['constitution']['end'] = '2026-10-17T12:00:00+01:00'
    body['case']['constitution']['fixed_blocks'] = []
    old = client.post('/api/trial/run', json=body).json()
    pardon = dict(**previous(old, 'pardon-full'), pardon=True)
    pardon['case'] = body['case']
    response = client.post('/api/trial/appeal', json=pardon)
    assert response.status_code == 200, response.text
    restored = next(d for d in response.json()['decisions'] if d['task_id'] == 'instagram')
    assert restored['verdict'] == 'APPROVED' and restored['schedule_status'] == 'PENDING'
    assert restored['approved_min'] == 45 and restored['saved_min'] == 0


def test_revise_fallback_is_light_and_does_not_mutate_trial(client):
    result = run(client)
    body = dict(**previous(result, 'revise-1'), instruction='detail'); body['task_id'] = 'emails'
    response = client.post('/api/trial/revise', json=body)
    assert response.status_code == 200, response.text
    order = response.json()
    assert order['source'] == 'fallback' and 'revision' not in order and 'schedule' not in order
    assert sum(s['minutes'] for s in order['action_plan']) == 15
    assert all(s['detail'] for s in order['action_plan'])
    assert client.post('/api/trial/revise', json=body).json() == order
    assert run(client) == result
    body['request_id'] = 'revise-dismissed'; body['task_id'] = 'instagram'
    assert client.post('/api/trial/revise', json=body).status_code == 422


@pytest.mark.parametrize('bad_budget', [False, True])
def test_revise_uses_plan_model_and_validates_budget(client, monkeypatch, bad_budget):
    old = run(client)
    monkeypatch.setenv('TRIAL_MODE', 'live'); monkeypatch.setenv('NEBIUS_PLAN_MODEL', 'mock-rich-model')
    models = []
    class Provider:
        def __init__(self, settings): models.append(settings.model)
        async def revise(self, task, decision, instruction):
            return RevisedOrder(first_move='Open the urgent folder.', done_when='Five replies sent.',
                action_plan=[DetailedStep(step='Select urgent messages', minutes=5, detail='Select the five confirmed urgent messages.'),
                             DetailedStep(step='Send replies', minutes=9 if bad_budget else 10, detail='Write and send a direct reply to each.')]), Meta()
    app.state.service.provider_factory = Provider
    body = dict(**previous(old, 'revise-live'), instruction='I only have my phone'); body['task_id'] = 'emails'
    result = client.post('/api/trial/revise', json=body).json()
    assert result['source'] == ('fallback' if bad_budget else 'live')
    assert sum(s['minutes'] for s in result['action_plan']) == 15
    assert models == ['mock-rich-model']


def test_revise_stale_revision_rejected(client):
    old = run(client)
    client.post('/api/trial/appeal', json=appeal_body(old))
    body = dict(**previous(old, 'stale-revise'), instruction='detail'); body['task_id'] = 'emails'
    assert client.post('/api/trial/revise', json=body).status_code == 409


def test_personas_are_distinct_and_prosecution_has_no_fields():
    request = RunRequest.model_validate(fixture('run.request.json'))
    proposal = from_demo(request)
    for row in proposal.decisions:
        row.persona.name = 'The Task Advocate'
        row.prosecution = 'allow_reduction is false; minimum_min is 15.'
    result = build_result(request.case, proposal, 'characters', 'live', Meta())
    assert len({d.persona.name for d in result.decisions}) == 5
    assert all(d.persona.archetype for d in result.decisions)
    assert all('_' not in d.prosecution and 'false' not in d.prosecution for d in result.decisions)


def test_run_temperature_zero_and_rules_reach_provider():
    bodies = []
    request = RunRequest.model_validate(fixture('run.request.json'))
    request.case.rules = Rules(mode='immediate', severity=0.8, drama=1)
    async def handler(http_request):
        bodies.append(json.loads(http_request.content))
        return httpx.Response(200, json={'choices':[{'message':{'content':from_demo(request).model_dump_json()}}]})
    asyncio.run(NebiusClient(Settings(api_key='mock', model='mock'), httpx.MockTransport(handler)).run(request.case))
    assert bodies[0]['temperature'] == 0
    payload = json.loads(bodies[0]['messages'][1]['content'])
    assert payload['case']['rules']['severity'] == 0.8
