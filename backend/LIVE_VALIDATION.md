# Live generation validation

## Urgent Quick-trial reliability fix

Server logs after the rounds update identify round_one_mismatch as the repeated
failure: valid provider responses were retried and discarded because optional
exchanges did not exactly match legacy defense/prosecution fields. Observed failed
runs took 17.8–19.3 seconds, two calls, and returned conservative fallback. This was
a validation regression, not evidence of a new model failing. Lightning was already
the previously working model and remains selected.

Exchanges are now optional. Malformed, incomplete, repeated, out-of-order, ungrounded
or incompatible optional lists are discarded while core verdicts remain strict.
No fabricated additional debate is inserted into live results. Local regressions
verify each failure class retains the live verdicts with exactly one provider call.

A fresh six-task Quick check used 240 minutes, the 45-minute study witness answer,
and mandatory study with shortening explicitly permitted. /run returned live in
5,422 ms, one call: original 365, approved 215, recovered 150, pending 0, free 25.
Run, emails and TikTok were dismissed; study retained 45 minutes. Live interrogation
proposed the unconfirmed 15-minute screen-free break. Accepted appeal applied it at
revision 2, approved 230, recovered 135, pending 0, free 10. The appeal assessment
failed provider validation and was honestly labelled fallback; its explicitly
accepted replacement and updated calendar were still applied and validated.

These are observed results, not guaranteed future verdicts. Older required-exchange
schema descriptions below document the earlier implementation, now superseded.

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

## Grand trial: six tasks and three rounds (17 October 2026)

The prepared five-task case plus a synthetic 15-minute "Tidy desk" task was used
for a six-task/three-round structural check. All 36 speeches share one generation.
The first schema allowed exchanges to be omitted; Lightning did omit them. Making
exchanges required with exactly six items per task resolved the observed omission.

| Model / schema | Calls | Observed latency | Result |
| --- | --- | --- | --- |
| Lightning, required exchanges | 1 | 14,641 ms | live, 36 valid exchanges |
| Lightning, stronger grounding prompt | 1 | 20,101 ms | live, 36 valid exchanges |
| GLM-5.3-Flash, same Grand workload | 1 | 25,002 ms | timeout/fallback |

Lightning remains the /run model; Flash remains the faster detailed-plan model.
Grand's measured 20-second wait matters for a two-minute presentation: Quick is
the safer live pacing unless the Grand generation is already ready. These samples
do not establish a reliable upper latency bound or an all-task quality benchmark.

Manual review found unsupported personal-history claims in an earlier response.
The prompt now forbids these and a targeted validator rejects obvious patterns.
Later review still found speculative numerical benefits; the prompt was tightened
again to forbid invented quantified savings and label estimates. That last prompt
edit has not been retested live. Structural validation cannot guarantee semantic
grounding, novel arguments or the logically stronger verdict. Rehearse the actual
output; do not present illustrative recovered totals as guaranteed results.

Cross-review recovery/questioning changes are covered locally with fake providers:
no-fact dismissed task -> proposal -> accepted appeal, no mutation on questioning,
live build/verification failures -> labelled fallback, and unrecoverable validation
-> structured 503 with CORS.

Three bounded live /interrogate checks used the already authorised Instagram example
with its facts removed and a dismissed decision. Each completed in one provider call:

| Purpose prompt | Observed latency | Result |
| --- | --- | --- |
| Optional alternative instruction | 420 ms | No comment; no proposal |
| Explicit alternative instruction | 742 ms | Proposal still shortened Instagram; unsuitable |
| Explicit instruction plus alternative example | 804 ms | Screen-free break, 15 minutes, valid 2+13 plan |

The final response retained "No comment."/evasive for the evidence-backed answer and
marked the possible rest need unconfirmed in cut_scope. It invented no fatigue or
personal history. The 30 saved minutes on the proposal describe its potential scope
change; questioning does not apply those savings. The plan sum was validated before
and after proposal normalization. This demonstrates the prepared no-fact purpose
path; it does not guarantee the same proposal for every task or future call.
