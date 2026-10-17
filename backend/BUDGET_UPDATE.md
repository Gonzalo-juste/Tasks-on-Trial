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

## Pending clarification: automatic over-budget verdicts

Carlos requests reduction to minima from lowest category priority upwards, then
dismissal of the lowest-priority non-mandatory tasks if still over budget. However,
the published chaotic-day quick capture currently makes TikTok reducible to 10,
gym to 30 and slides to 60. With the study witness accepting 45, that algorithm
can fit with slides 90, emails 30, study 45, gym 30 + buffer 20, TikTok 10 = 225.
It therefore would not dismiss TikTok or reduce emails to 10.

The requested output (slides 90, emails 10, study 45, gym 60 + buffer 20, TikTok
dismissed) also totals 225, but requires different task constraints or a different
general policy. Gonzalo has been asked which should prevail. Automatic verdict
rewrites are not implemented in this checkpoint; over-budget retained work still
becomes pending, subject to the new explicit budget cap. Do not claim the exact
requested verdicts are delivered by this accounting change.

The exam-context/learning-category correction is already present in /init.
