# Explicit budget and buffer-inclusive accounting

Case accepts optional budget_min: a strict integer from 0 to 1440. Missing/null
uses calendar capacity. Effective budget is the smaller of the explicit value and
window minutes minus the union of fixed commitments. The scheduler caps actual
placements at that budget, including buffer time, independently of calendar fit.
free_capacity_min is the effective budget minus scheduled work and buffers.

Aggregate original_min includes requested work plus all buffers. Aggregate
approved_min includes approved work and buffers of retained tasks, even when
pending. Aggregate pending_min includes pending work and its overhead. This keeps
approved = scheduled load + pending load. A pending task creates no savings.

Per-decision original_min/approved_min remain work-only so court-order steps still
sum to approved_min. saved_min adds the task's buffer only when DISMISSED, since
no travel/setup is then reserved. minutes_recovered is the sum of saved_min and
equals aggregate original minus aggregate approved. No existing fields are renamed.

The older buffer-free fixtures remain unchanged. The earlier five-task v4 tests
now report 395 original and 305 approved (including the gym buffer), with the same
90 recovered and 175 free; after the break, 320 approved, 75 recovered and 160 free.

## Clarified precedence: judge first, deterministic cuts second

The latest Carlos clarification replaces the earlier two-pass reduction policy.
Hard constraints always win. Within them the judge's valid verdicts prevail. A
non-mandatory task can be dismissed even if it has no facts; minimum_min is the
floor only when retained. Null citations are allowed; any supplied citation still
must be genuine. Reduction permission, minimums and mandatory protection remain.

Only when the validated /run model allocation exceeds the effective budget does
Python process lowest-priority categories first, with task ID as a stable tie break:

- No facts and non-mandatory: DISMISSED, with reason starting not_proven and a
  defer release. Recover work plus buffer.
- Facts and allow_reduction: REDUCED to minimum_min if not already there.
- Mandatory tasks are never dismissed; authorised reductions never cross minimum.
- Retained dependencies are protected from automatic dismissal. Repeat if a later
  cut makes an earlier prerequisite eligible; stop immediately when within budget.

If mandatory work plus its buffers alone exceeds the budget, status is conflict
and conflicts includes code impossible_as_filed, alongside placement conflicts.
Actual placement never exceeds budget. Protected or unreducible work that cannot
fit stays pending; neither pending work nor its buffer becomes recovered time.

Provider-failure fallback has no model judgment to correct: it retains confirmed
scope and places only what fits, explicitly labelled fallback. Pardon and accepted
replacement flows preserve their user-authorised scope and rebuild placement;
these are not silently overridden by /run's automatic cuts.

Chaotic-day original load is 335 including the gym buffer. If the judge recommends
emails 10, study 45 and TikTok dismissed, its 225 allocation is preserved: 110
recovered and 15 free. If the judge keeps every original task, Python dismisses
fact-free TikTok, reduces gym to 30 plus buffer 20, then study to 45, and stops:
215 allocated, 120 recovered, 25 free. This depends on the confirmed facts actually
present in the request, not task names or a hardcoded demo verdict.

The exam-context/learning-category correction is already present in /init.
