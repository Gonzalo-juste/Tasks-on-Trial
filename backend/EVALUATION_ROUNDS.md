# Burden-of-proof evaluation and courtroom rounds

Latest product update: reduce legitimate non-leisure needs before dismissing
them, then refill useful work that fits. Work/health/learning/family/money with
allow_reduction=true are reduced to minimum_min before whole-task cancellation;
health needs no invented or typed fact to be eligible. Mandatory/non-reducible
constraints remain binding. Unsupported leisure is dismissed first and stays
excluded from refill, preserving a merits dismissal rather than resurrecting it
just because time remains. This supersedes the older no-facts-first policy below.

Refill admits dismissed useful tasks at their confirmed minimum (full duration
for non-reducible tasks), highest burden score first, before restoring extra
minutes. It retries admission for dependency order. Every candidate includes its
buffer and must allow ALL retained work to be scheduled with valid deadlines,
commitments, dependencies, no overlaps and budget. Retained reductions are restored
only up to their pre-Python allocation, and only if that whole former scope fits;
valid LLM reductions are not inflated back to the original request. Spare time
alone is not proof that a task can be placed in the calendar.

APPROVED plus fewer permitted minutes is normalized to REDUCED. Normal minimum,
permission and citation checks still apply. APPROVED plus zero/increased minutes
does not authorize an invalid allocation. Plans and metrics are rebuilt consistently.

The requested six-task target needs slides to permit shortening: fixed slides 90,
fixed study 90, gym 30+20, run 15 and emails 10 total 255, exceeding 240. With slides
explicitly reducible to 70 the minimum total is 235. Python does not silently unlock
slides to force this result; the frontend must submit the intended permission/minimum.

Demo reliability correction: exchanges are now OPTIONAL enrichment. Missing,
malformed or invalid exchanges are discarded without rejecting otherwise valid
live recommendations or triggering another provider call. The original defense
and prosecution remain available. This supersedes the required-exchanges schema
described in the initial implementation below. Financial/calendar invariants,
mandatory protection, task IDs and verdict validation remain strict.

This update supersedes category-only automatic budget cuts. Existing response
fields remain; generated decisions add exchanges. No frontend files are edited.

## Evaluation and hard constraints

allow_reduction=false forbids shortening, not dismissal. A non-mandatory task
can therefore be kept in full or dismissed. Python never cuts mandatory tasks
during its budget pass. Their scheduling failures remain explicit conflicts.

The judge receives the following deterministic burden score for optional tasks:

- Evidence: +3 for each distinct confirmed supporting fact for today. A typed
  deadline inside the window also counts, without duplicating a textual deadline.
- Urgency: +3 for a typed deadline inside the window; +1 for a deadline after the
  window or a later-day mention such as tomorrow/Monday/next week.
- Priority: +2 first category, +1 second, zero for the rest.
- Cost: subtract (requested work + buffer) / 30. This is fractional, not rounded
  up to whole half-hours. Total scores use four decimal places for stable ordering.
- Leisure: subtract 1 if leisure lacks supporting/protective evidence. An explicit
  request to protect downtime counts as evidence; leisure is not inherently worthless.

Supporting evidence uses a conservative English/Spanish lexical heuristic for
today, need, explicit obligation, sufficient scope and protected downtime. Travel,
setup, mere task titles, optionality and negative statements do not qualify.
Repeated copies of a fact are counted once. This is a transparent heuristic,
not a semantic verifier of truth or logical necessity.

The provider may supply private score_adjustment -1, 0 or +1, with a short
score_reason for nonzero changes. Out-of-range values fail validation. These
private fields do not add public decision fields. Adjustments never override
mandatory protection, minimums, shortening permission or calendar constraints.

Valid judge verdicts remain unless their allocation exceeds the effective budget.
Python first processes requests with no confirmed facts and no typed deadline,
before cutting work with a confirmed record. Within that group and then the
remaining tasks, it processes lowest score first, using task ID for stable ties:

1. Supported and reducible above minimum: REDUCED to minimum_min.
2. Without supporting evidence: DISMISSED, even if shortening is forbidden.
3. Supported but non-reducible, or already at minimum: dismiss as a whole if still
   over budget. A subsequent pass can drop a task reduced in the earlier pass.

Stop immediately when the allocation fits. Retained dependencies are protected
from automatic dismissal. Reasons identify the score, priority, cost and actual
supporting input; overhead facts are never cited as work-reduction evidence.
Mandatory tasks that cannot fit produce conflicts, including impossible_as_filed
when their own work and buffers exceed the budget. Provider-failure fallback
preserves confirmed scope and stays labelled fallback; user-authorised pardons
and replacements are not silently re-judged by this /run policy.

The no-facts-first pass is a budget rule. It does not force a particular verdict
when the judge's accepted allocation already fits. A typed deadline is confirmed
evidence even when the separate facts list is empty. A travel-only fact is a
confirmed record but still contributes zero supporting evidence for work today.

The older illustrative 215-minute category-cut result is no longer a target.
For example, travel-only gym evidence contributes no proof of training today;
the score policy can dismiss that task instead of shortening it. Live verdicts
and later budget changes legitimately alter totals. No task names are hardcoded.

## Round contract

Send optional rules.rounds as a strict integer 1, 2 or 3. Explicit rounds win.
Without it: quick=1, immediate=1, standard=2, grand=3. As a transitional
compatibility rule, quick with drama >=0.85 also derives 3. Standard cannot
reliably be inferred from drama: send rounds:2 or mode:standard.

Grand mode sends drama:1 to the model without mutating the confirmed case or its
session fingerprint. Frontend pacing controls screen time; the backend adds no
per-argument delay or duration fields.

When present and valid, a generated decision returns exactly 2*rounds exchanges:

```json
{
  "defense": "I request time for the confirmed deliverable.",
  "prosecution": "Its necessity today must still be justified.",
  "exchanges": [
    {"round": 1, "speaker": "defense", "text": "I request time for the confirmed deliverable."},
    {"round": 1, "speaker": "prosecution", "text": "Its necessity today must still be justified."}
  ]
}
```

Subsequent rounds alternate defense/prosecution in the same way, ending with the
prosecution. Each text is at most 200 characters. defense/prosecution equal round
one exactly. The provider schema leaves the list optional. All tasks and exchanges
share one /run generation, with the existing bounded retry retained for invalid
core recommendations. An invalid optional list is dropped instead of retried.

Checks discard lists with wrong counts, ordering, round numbers, exact repeated
arguments or round-one mismatches. The prompt asks for new, grounded arguments and direct
rebuttals. A targeted check rejects obvious invented personal-history statements
unless quoting a supplied fact. These checks do not prove semantic novelty or
that a verdict follows the logically stronger argument; those remain model-quality
limitations. Speculative benefits must be labelled as estimates, never personal facts.

Provider-failure fallback returns the requested number of clearly non-live speeches based on known
inputs and unavailable assessment. It does not fabricate an independent debate.
Original recorded replay fixtures remain unchanged and may omit exchanges; clients
can continue using defense/prosecution for those legacy recordings.
Live decisions can also omit exchanges: use their existing defense/prosecution.
No synthetic multi-round debate is substituted into a live result.

Appeal/pardon result rebuilding preserves exchange shape and round-one compatibility.
Changing the confirmed rules or case after a trial still requires a fresh /run.

## Cross-examination and safe recovery

Live /interrogate calls the provider even with an empty facts list and no deadline.
An evasive "No comment." answer may still carry an optional smaller-scope proposal.
For purpose questions, the model may propose an explicitly unconfirmed need from
the task title/category, such as a screen-free break instead of scrolling. It must
not invent fatigue or personal history. Existing proposal fields are unchanged;
the prompt marks uncertainty in title/cut_scope. Questioning neither confirms the
need nor changes facts, revision, verdict, metrics or schedule. Explicitly accepting
the replacement through /appeal is what applies it.

ValueError (including final invariant validation) during a live /run build now
returns a conservative, validated result with source:fallback. It preserves the
confirmed durations rather than claiming an unavailable judgement. Diagnostics
contain reason code, error class, model, call count and latency, never raw model
output, exception contents or input facts. If the fallback also cannot be validated,
the route returns structured 503 PROVIDER_UNAVAILABLE through the normal CORS path.

Existing not_proven:/budget_reduction: reason prefixes remain. No session storage
migration is included. For the demo, use CORS_ORIGINS=http://localhost:3000, start
without --reload, then start a fresh trial after the one activation restart. Any
later restart loses in-memory sessions; do not modify/restart the demo process
after freeze unless a new fix is explicitly required.
