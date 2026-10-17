"""Explicit opt-in live checks using only Carlos's prepared five-task example."""
import argparse
import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import json
from .config import Settings
from .nebius_client import NebiusClient, ProviderFailure
from .schemas import RunRequest
from .service import fixture
from .tribunal import build_result

async def check(model, repeats, response_format):
    case=RunRequest.model_validate(fixture('run.request.json')).case
    settings=replace(Settings.load(),model=model,response_format=response_format)
    for i in range(repeats):
        try:
            proposal,meta=await NebiusClient(settings).run(case)
            result=build_result(case,proposal,f'live-check-{i}','live',meta)
            decisions={d.task_id:d for d in result.decisions}
            row={'checked_at':datetime.now(timezone.utc).isoformat(),'task_count':len(case.tasks),
                'source':'live',**meta.model_dump(),'metrics':result.metrics.model_dump(),
                'decisions':[{'task_id':r.task_id,'proposed_verdict':r.recommendation,
                    'proposed_min':r.approved_min,'verdict':decisions[r.task_id].verdict,
                    'approved_min':decisions[r.task_id].approved_min,
                    'cites_confirmed_fact':r.fact_cited in next(t.facts for t in case.tasks if t.id==r.task_id),
                    'plan_steps':len(decisions[r.task_id].action_plan)} for r in proposal.decisions]}
        except ProviderFailure as exc:
            row={'checked_at':datetime.now(timezone.utc).isoformat(),'task_count':len(case.tasks),
                'source':'fallback','model':model,'llm_calls':exc.calls,'latency_ms':exc.latency_ms,'reason':exc.reason}
        print(json.dumps(row),flush=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description='Sends prepared demo data to Nebius and may consume inference credit.')
    parser.add_argument('--model',required=True)
    parser.add_argument('--format',default='json_object',choices=['json_object','json_schema'])
    parser.add_argument('--repeats',type=int,default=1,choices=[1,2,3])
    parser.add_argument('--allow-live',action='store_true',help='Explicitly authorise sending the demo fixture to Nebius')
    args=parser.parse_args()
    if not args.allow_live:
        parser.error('Pass --allow-live to authorise external inference.')
    asyncio.run(check(args.model,args.repeats,args.format))
