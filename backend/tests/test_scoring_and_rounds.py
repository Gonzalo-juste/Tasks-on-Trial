"""Burden scoring and multi-round wire contract, independent of model prose quality."""
import asyncio
import json
from datetime import timedelta
import httpx
import pytest
from pydantic import ValidationError

from backend.config import Settings
from backend.courtroom import round_count, validate_exchanges, validate_personal_history
from backend.evaluation import burden_score
from backend.nebius_client import NebiusClient, ProviderFailure
from backend.schemas import Case, Task, Rules, RunRequest, RunProposal, Exchange, Meta, provider_run_schema
from backend.service import fixture
from backend.tribunal import fallback_recommendation, build_result
from backend.tests.test_engine import from_demo


def base_case():
    return RunRequest.model_validate(fixture('run.request.json')).case


def task(**updates):
    values=dict(id='optional',title='Optional work',duration_min=60,minimum_min=15,
                category='work',allow_reduction=True,facts=[])
    values.update(updates)
    return Task.model_validate(values)


def test_score_counts_only_supporting_today_evidence_and_real_cost():
    case=base_case();case.constitution.priorities=['work','learning','health','leisure']
    value=task(duration_min=45,buffer_min=15,facts=[
        'Only five emails need a reply today', 'Needs 15 minutes of travel',
        'Only five emails need a reply today', 'A draft is enough today'])
    score=burden_score(case,value)
    assert (score.evidence,score.urgency,score.priority,score.cost,score.leisure)==(6,0,2,2,0)
    assert score.total==6 and len(score.supporting)==2


@pytest.mark.parametrize('fact',['Needs 20 minutes of travel','This can wait until another day',
                                'No emails need a reply today','Travel is required today'])
def test_overhead_and_negative_facts_are_not_supporting_evidence(fact):
    assert burden_score(base_case(),task(facts=[fact])).supporting==()


def test_typed_deadline_counts_as_evidence_and_urgency():
    case=base_case();value=task(deadline=case.constitution.start+timedelta(hours=1))
    score=burden_score(case,value)
    assert score.evidence==3 and score.urgency==3 and score.supporting
    value.deadline=case.constitution.end+timedelta(hours=1)
    score=burden_score(case,value)
    assert score.evidence==0 and score.urgency==1


@pytest.mark.parametrize('fact,urgency',[('Maths exam on Monday',1),('Travel next Monday',0),('Exam last Friday',0)])
def test_later_context_needs_a_deadline_or_event_not_merely_a_day(fact,urgency):
    assert burden_score(base_case(),task(facts=[fact])).urgency==urgency


def test_protected_leisure_has_evidence_and_no_leisure_penalty():
    case=base_case()
    unprotected=burden_score(case,task(category='leisure',duration_min=45))
    protected=burden_score(case,task(category='leisure',duration_min=45,facts=['I want to protect this downtime']))
    assert unprotected.leisure==1
    assert protected.leisure==0 and protected.evidence==3
    assert protected.total>unprotected.total


def test_support_can_outweigh_first_category_priority():
    case=base_case();case.constitution.priorities=['work','learning']
    unsupported_work=burden_score(case,task(category='work'))
    supported_study=burden_score(case,task(category='learning',facts=['45 focused minutes would be enough today']))
    assert supported_study.total>unsupported_work.total


def test_judge_adjustment_is_bounded_and_requires_reason_to_apply():
    case=base_case();value=task();row=fallback_recommendation(value)
    base=burden_score(case,value).total
    row.score_adjustment=1
    assert burden_score(case,value,row).total==base
    row.score_reason='The confirmed deliverable is narrowly defined.'
    assert burden_score(case,value,row).total==base+1
    with pytest.raises(ValidationError):
        type(row).model_validate({**row.model_dump(),'score_adjustment':2})


def test_nonreducible_supported_optional_task_can_be_dismissed_whole():
    case=base_case();case.budget_min=30
    value=task(allow_reduction=False,facts=['This needs to be done today'])
    case.tasks=[value]
    result=build_result(case,RunProposal(decisions=[fallback_recommendation(value)]),'all-or-nothing','live',Meta())
    decision=result.decisions[0]
    assert decision.verdict=='DISMISSED' and decision.approved_min==0
    assert 'budget_dismissal' in decision.reason and 'score' in decision.reason


def test_mandatory_tasks_are_not_cut_even_when_reducible():
    case=base_case();case.budget_min=30
    value=task(mandatory=True,allow_reduction=True,facts=['This must happen today'])
    case.tasks=[value]
    result=build_result(case,RunProposal(decisions=[fallback_recommendation(value)]),'mandatory','live',Meta())
    assert result.decisions[0].approved_min==60 and result.status=='conflict'


def test_no_fact_request_is_dismissed_before_reducing_evidenced_lower_score():
    case=base_case();case.budget_min=150
    case.constitution.priorities=['work','learning','health','leisure']
    unsupported=task(id='no-proof',duration_min=60,allow_reduction=False)
    supported=task(id='proof',duration_min=120,category='health',facts=['This needs doing today'])
    case.tasks=[unsupported,supported]
    assert burden_score(case,supported).total < burden_score(case,unsupported).total
    result=build_result(case,RunProposal(decisions=[fallback_recommendation(t) for t in case.tasks]),
                        'no-proof-first','live',Meta())
    assert result.decisions[0].verdict=='DISMISSED'
    assert 'not_proven:' in result.decisions[0].reason
    assert result.decisions[1].approved_min==120


def test_confirmed_deadline_is_evidence_even_with_empty_fact_list():
    case=base_case();case.budget_min=130
    deadline_task=task(id='deadline',duration_min=120,deadline=case.constitution.end)
    optional=task(id='no-proof',duration_min=60,category='work')
    case.tasks=[deadline_task,optional]
    result=build_result(case,RunProposal(decisions=[fallback_recommendation(t) for t in case.tasks]),
                        'deadline-evidence','live',Meta())
    assert result.decisions[0].approved_min==120 and result.decisions[1].verdict=='DISMISSED'


@pytest.mark.parametrize('mode,count',[('quick',1),('standard',2),('grand',3),('immediate',1)])
def test_modes_derive_round_count(mode,count):
    case=base_case();case.rules=Rules(mode=mode)
    assert round_count(case)==count


def test_explicit_rounds_take_precedence_and_old_grand_drama_works():
    case=base_case();case.rules=Rules(mode='quick',drama=.85)
    assert round_count(case)==3
    case.rules.rounds=2
    assert round_count(case)==2


@pytest.mark.parametrize('value',[0,4,True,1.5,'3'])
def test_round_count_is_a_strict_one_to_three_integer(value):
    with pytest.raises(ValidationError): Rules(rounds=value)


@pytest.mark.parametrize('count',[1,2,3])
def test_fallback_has_complete_ordered_rounds_and_compatibility_fields(count):
    case=base_case();case.rules=Rules(rounds=count)
    result=build_result(case,None,'rounds-fallback','fallback',Meta())
    for decision in result.decisions:
        assert len(decision.exchanges)==2*count
        validate_exchanges(decision.exchanges,count,decision.defense,decision.prosecution)
        assert all(len(exchange.text)<=200 for exchange in decision.exchanges)


@pytest.mark.parametrize('kind',['count','speaker','round','repeat','compatibility'])
def test_invalid_generated_exchange_structure_is_rejected(kind):
    exchanges=[Exchange(round=1,speaker='defense',text='I request a bounded scope.'),
               Exchange(round=1,speaker='prosecution',text='The necessity today is unproven.')]
    defense,prosecution=exchanges[0].text,exchanges[1].text
    if kind=='count':exchanges.pop()
    if kind=='speaker':exchanges[1].speaker='defense'
    if kind=='round':exchanges[1].round=2
    if kind=='repeat':exchanges[1].text=exchanges[0].text
    if kind=='compatibility':defense='A different sentence.'
    with pytest.raises(ValueError):validate_exchanges(exchanges,1,defense,prosecution)


def test_grand_all_exchanges_share_one_provider_request():
    case=base_case();case.rules=Rules(mode='grand',drama=.5,rounds=3)
    proposal=from_demo(RunRequest(request_id='grand',confirmed=True,case=case))
    for row in proposal.decisions:
        row.exchanges=[Exchange(round=i,speaker=speaker,text=f'{row.task_id}: {speaker} argument {i}')
                       for i in range(1,4) for speaker in ['defense','prosecution']]
        row.defense,row.prosecution=row.exchanges[0].text,row.exchanges[1].text
    bodies=[]
    async def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200,json={'choices':[{'message':{'content':proposal.model_dump_json()}}]})
    async def check():
        return await NebiusClient(Settings(api_key='mock',model='mock'),httpx.MockTransport(handler)).run(case)
    returned,meta=asyncio.run(check())
    assert meta.llm_calls==1 and len(bodies)==1
    payload=json.loads(bodies[0]['messages'][1]['content'])
    assert payload['rounds']==3 and payload['case']['rules']['drama']==1
    assert len(returned.decisions[0].exchanges)==6
    assert 'burden_of_proof' in payload
    assert case.rules.drama==.5  # Do not mutate the confirmed case or session fingerprint.


@pytest.mark.parametrize('rounds',[1,2,3])
def test_provider_schema_keeps_exchanges_optional(rounds):
    schema=provider_run_schema(rounds).model_json_schema()
    decision=schema['$defs']['Recommendation']
    assert 'exchanges' not in decision['required']
    assert decision['properties']['exchanges']['maxItems']==6


@pytest.mark.parametrize('kind',['missing','null','shape','long_text','count','speaker','round','repeat','compatibility','history'])
def test_bad_optional_exchanges_do_not_retry_or_lose_live_verdicts(kind):
    case=base_case()
    proposal=from_demo(RunRequest(request_id='optional-exchanges',confirmed=True,case=case))
    body=proposal.model_dump(mode='json')
    row=body['decisions'][2]
    if kind=='missing':row.pop('exchanges')
    elif kind=='null':row['exchanges']=None
    elif kind=='shape':row['exchanges']={'unexpected':'shape'}
    elif kind=='long_text':row['exchanges'][0]['text']='x'*201
    elif kind=='count':row['exchanges'].pop()
    elif kind=='speaker':row['exchanges'][1]['speaker']='defense'
    elif kind=='round':row['exchanges'][1]['round']=2
    elif kind=='repeat':row['exchanges'][1]['text']=row['exchanges'][0]['text']
    elif kind=='compatibility':row['exchanges'][0]['text']='A different optional speech.'
    elif kind=='history':
        row['defense']=row['exchanges'][0]['text']='I have ignored these emails before.'
    calls=[]
    async def handler(request):
        calls.append(1)
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(body)}}]})
    async def check():
        return await NebiusClient(Settings(api_key='mock',model='mock'),httpx.MockTransport(handler)).run(case)
    returned,meta=asyncio.run(check())
    result=build_result(case,returned,'optional-exchanges','live',meta)
    assert result.source=='live' and result.metrics.minutes_recovered==120
    assert result.decisions[2].verdict=='REDUCED' and result.decisions[2].approved_min==15
    assert not result.decisions[2].exchanges
    assert meta.llm_calls==1 and len(calls)==1


def test_invented_personal_history_is_rejected_but_quoted_evidence_is_allowed():
    speech=Exchange(round=1,speaker='defense',text='I have skipped sessions before and still maintained my routine.')
    value=task()
    with pytest.raises(ValueError):validate_personal_history([speech],value)
    value.facts=[speech.text]
    validate_personal_history([speech],value)


def test_scope_replacement_retains_round_one_compatibility():
    from backend.tribunal import accepted_decision
    from backend.schemas import Replacement
    case=base_case();case.rules=Rules(rounds=3)
    original=build_result(case,None,'before-replacement','fallback',Meta())
    old=original.decisions[2]
    old.defense='I request the explicitly accepted urgent replies.'
    old.prosecution='The user has accepted the smaller scope.'
    changed=accepted_decision(case.tasks[2],old,Replacement(title='Urgent replies',duration_min=15))
    original.decisions[2]=changed
    result=build_result(case,None,'after-replacement','fallback',Meta(),decisions=original.decisions)
    validate_exchanges(result.decisions[2].exchanges,3,result.decisions[2].defense,result.decisions[2].prosecution)
    assert result.decisions[2].defense=='I request the explicitly accepted urgent replies.'
