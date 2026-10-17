"""Demo regressions: evidence-free questioning and safe live-result recovery."""
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.schemas import InterrogationProposal, Meta, RunProposal
from backend.service import TrialService, fixture
from backend.tribunal import fallback_recommendation


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('TRIAL_MODE', 'live')
    app.state.service = TrialService()
    with TestClient(app) as value:
        yield value


class Provider:
    def __init__(self, settings):
        pass

    async def run(self, case, target_id=None, *args):
        rows = [fallback_recommendation(t) for t in case.tasks if target_id is None or t.id == target_id]
        return RunProposal(decisions=rows), Meta(model='local-test', llm_calls=1, latency_ms=12)


@pytest.mark.parametrize('stage', ['provider', 'build', 'verify'])
def test_invalid_live_result_recovers_with_cors_and_idempotency(client, monkeypatch, caplog, stage):
    import backend.service as service
    calls = []

    class Broken(Provider):
        async def run(self, *args):
            calls.append(1)
            if stage == 'provider':
                raise ValueError('PRIVATE model text must not be logged')
            return await super().run(*args)

    app.state.service.provider_factory = Broken
    original = getattr(service, 'build_result' if stage == 'build' else 'verify_result')

    if stage != 'provider':
        def fail_live(*args, **kwargs):
            source = args[3] if stage == 'build' else args[1].source
            if source == 'live':
                raise ValueError('PRIVATE model text must not be logged')
            return original(*args, **kwargs)
        monkeypatch.setattr(service, 'build_result' if stage == 'build' else 'verify_result', fail_live)

    body = fixture('run.request.json')
    response = client.post('/api/trial/run', json=body, headers={'Origin': 'http://localhost:3000'})
    assert response.status_code == 200, response.text
    assert response.headers['access-control-allow-origin'] == 'http://localhost:3000'
    result = response.json()
    assert result['source'] == 'fallback' and result['metrics']['minutes_recovered'] == 0
    assert result['meta']['llm_calls'] == (0 if stage == 'provider' else 1)
    assert all(d['verdict'] == 'APPROVED' for d in result['decisions'])
    assert client.post('/api/trial/run', json=body).json() == result
    assert len(calls) == 1
    assert 'invalid_live_result' in caplog.text and 'PRIVATE model text' not in caplog.text


def test_invalid_provider_task_ids_recover_instead_of_500(client):
    class Broken(Provider):
        async def run(self, case, *args):
            proposal, meta = await super().run(case)
            proposal.decisions.pop()
            return proposal, meta
    app.state.service.provider_factory = Broken
    response = client.post('/api/trial/run', json=fixture('run.request.json'))
    assert response.status_code == 200 and response.json()['source'] == 'fallback'


def test_unrecoverable_validation_returns_structured_503_with_cors(client, monkeypatch):
    import backend.service as service
    app.state.service.provider_factory = Provider
    def fail(*args, **kwargs):
        raise ValueError('Invalid result')
    monkeypatch.setattr(service, 'verify_result', fail)
    response = client.post('/api/trial/run', json=fixture('run.request.json'),
                           headers={'Origin': 'http://localhost:3000'})
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'PROVIDER_UNAVAILABLE'
    assert response.headers['access-control-allow-origin'] == 'http://localhost:3000'
    assert not app.state.service.store.sessions


def test_fact_free_dismissed_task_can_propose_then_appeal_without_auto_mutation(client):
    calls = []

    class WithProposal(Provider):
        async def run(self, case, target_id=None, *args):
            proposal, meta = await super().run(case, target_id)
            for row in proposal.decisions:
                if row.task_id == 'instagram':
                    row.recommendation, row.approved_min = 'DISMISSED', 0
            return proposal, meta

        async def interrogate(self, task, decision, question_type, question_text):
            calls.append((task.id, task.facts[:], task.deadline))
            replacement = fixture('interrogate.response.json')['proposal']
            replacement['cut_scope'] = ['Possible rest need is unconfirmed; accept only if it fits.']
            return InterrogationProposal(answer='No comment.', rating='evasive',
                credibility_delta=-0.1, proposal=replacement), Meta(model='local-test', llm_calls=1)

    app.state.service.provider_factory = WithProposal
    run_body = fixture('run.request.json')
    next(t for t in run_body['case']['tasks'] if t['id'] == 'instagram')['facts'] = []
    response = client.post('/api/trial/run', json=run_body)
    assert response.status_code == 200, response.text
    result = response.json()
    before = deepcopy(app.state.service.store.sessions['run-01'].result)
    question = dict(request_id='no-facts-purpose', api_version='1', case=run_body['case'],
        previous_result=result, base_revision=1, task_id='instagram', question_type='purpose')
    response = client.post('/api/trial/interrogate', json=question)
    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer['source'] == 'live' and answer['proposal']['title'] == 'Screen-free break'
    assert answer['rating'] == 'evasive' and calls == [('instagram', [], None)]
    assert client.post('/api/trial/interrogate', json=question).json() == answer
    assert len(calls) == 1
    session = app.state.service.store.sessions['run-01']
    assert session.result == before and session.facts == {}
    appeal = {k: v for k, v in question.items() if k != 'question_type'}
    appeal.update(request_id='accept-break', accepted_replacement=answer['proposal'])
    response = client.post('/api/trial/appeal', json=appeal)
    assert response.status_code == 200, response.text
    changed = response.json()
    decision = next(d for d in changed['decisions'] if d['task_id'] == 'instagram')
    assert changed['revision'] == 2 and changed['appeals_used'] == 1
    assert decision['effective_title'] == 'Screen-free break' and decision['approved_min'] == 15
    assert decision['suggested_need']['status'] == 'confirmed'
