# Live generation validation

17 October 2026. Gonzalo explicitly authorised sending Carlos's prepared five-task
fixture, its durations and its confirmed facts to Nebius using his configured account.
No credentials or full task contents are stored in this report.

## Selected configuration

- Model: nvidia/Nemotron-3_5-Lightning
- Response format: json_schema
- Provider-specific control: chat_template_kwargs.enable_thinking=false
- One shared request for all five tasks; Python validates and builds the final result.
- One total 25-second budget, at most two attempts. A slow first attempt may use the
  remaining budget rather than being cut off prematurely at 19 seconds.

The direct-output control follows Nebius's own verified integration:
https://github.com/nebius/nebius-physical-ai/blob/main/docs/workbench/token-factory-deprecation-verification.md

Three consecutive strict-schema checks completed successfully, one call each:

| UTC time | Tasks | Model latency | Source | Recovered minutes |
| --- | --- | --- | --- | --- |
| 10:27:17 | 5 | 5336 ms | live | 105 |
| 10:27:50 | 5 | 3969 ms | live | 30 |
| 10:27:54 | 5 | 3864 ms | live | 60 |

Different recovered totals are expected from different model recommendations.
The rules and minute calculations remain deterministic for the accepted proposals.
For example, the engine rejected a proposed gym reduction without a confirmed fact.
It also preserved confirmed durations when a model marked a task APPROVED while
suggesting fewer minutes. No recommendation is promoted into an unauthorised saving.

## Earlier failures and limits

Both tested Qwen candidates exceeded the 25-second budget. Lightning without the
explicit direct-output control was inconsistent in latency. JSON mode also produced
invalid cosmetic field shapes or overlong summaries. These failures returned labelled
fallback, never a fabricated live result. Strict schema plus direct output resolved
these observed failures in the three checks above; it is not a universal guarantee.

This evidence covers five prepared tasks, not the six-task benchmark in the handoff.
It does not establish arbitrary-task quality, frontend compatibility, or multi-user
production readiness. The live endpoint and the rest of the demo are checked separately.

## Detailed-plan timeout diagnosis and fix (17 October 2026)

The reported generic court orders were labelled fallback in backend responses.
Server logs show repeated RevisedOrder timeouts at roughly 25,002 ms; holding the
session lock during inference made queued route times grow to 34–83 seconds.

Full zai-org/GLM-5.3 also timed out in two fresh prepared-email checks after setting
its documented reasoning_effort to low. The logs now include operation, model,
reason, call count and latency, without credentials, provider bodies or reasoning.

With the same prepared email facts and a 15-minute approved budget:

| Model | Instruction/input | Observed latency | Result |
| --- | --- | --- | --- |
| GLM-5.3, low effort | detail | 25,002 ms | timeout/fallback |
| GLM-5.3, low effort | Only the urgent ones | 25,002 ms | timeout/fallback |
| Nemotron-3_5-Lightning | detail | 1,379 ms | live, valid 15-minute plan |
| GLM-5.3-Flash, low effort | detail | 3,635 ms | live, valid 15-minute plan |
| GLM-5.3-Flash, low effort | detail from a generic one-step plan | 4,193 ms | live, four specific steps totalling 15 |
| GLM-5.3-Flash, low effort | Only the urgent ones from that generic plan | 3,440 ms | live, four specific steps totalling 15 |

The last two results were inspected: they identify the five urgent messages, split
the replies into concrete batches, and include detail and tips. This demonstrates
repair of the reported prepared case, not a general model-quality benchmark.
The fixture's existing approved scope includes snoozing non-urgent mail to Monday;
that wording in generated plans is not a newly inferred deadline.

The local plan-model setting and .env.example now select GLM-5.3-Flash; /run keeps
Lightning. The 25-second cap remains. Inference now runs outside the session lock,
followed by a fresh revision check before return/cache. Local concurrency tests
cover concurrent plans and a pardon making an in-flight plan stale.

Sources for the reasoning setting and available model families:
- https://docs.z.ai/guides/llm/glm-5.3
- https://nebius.com/services/token-factory/models/glm-models-inference
