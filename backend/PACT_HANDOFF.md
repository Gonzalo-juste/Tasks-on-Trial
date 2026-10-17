# Pact appeal — demo handoff

`POST /api/trial/appeal` now accepts `merge_task_ids: ["run"]` and optional `accepted_replacement.buffer_min: 0` (zero is significant). The original `case` stays unchanged. Existing minimum, duration, deadline, fixed-block, budget and overlap checks apply.

The accepted target keeps its replacement title and 15+25 minute plan. Its decision returns `buffer_min: 0`; Run returns `merged_into: "gym"`, DISMISSED, zero approved minutes, and reason `merged into <replacement title>`. These two optional decision fields MUST be preserved in `previous_result` on later requests, just like all other result fields. Schedule slots omit buffer_min when zero, as before.

The saved commute counts toward Gym's saved_min. Run's original work and buffer count toward its saved_min. Original metrics retain all originally filed buffers; sum(saved_min) still equals minutes_recovered. Breaks, if enabled, still consume schedule capacity. The 210-minute example assumes break_min=0.

A pact uses the user's explicit acceptance locally: no additional inference request is required. `source` is `fallback`, meta.llm_calls=0, and judge_summary/reason explicitly say the pact was accepted; this source does not indicate a failed provider call in this path. The current source enum has no separate manual/local value.

Budget fitting protects the accepted replacement, can reduce other eligible work, and never refills merged work. If the accepted pact cannot be scheduled without pending work, it returns INVALID_INPUT and leaves the current session unchanged. Mandatory tasks, mixed-category merges, duplicate/unknown/self IDs, dependency-linked tasks and existing pacts cannot be merged. A merged task cannot be pardoned or appealed separately; start a new trial to split it.

Local API regression case: slides 70 + study 90 + emails 10 + pact 40 = 210 approved, 155 recovered from 365 original, 0 pending, 0 free capacity. Includes lunch 13:00–13:30 in a 12:00–16:30 window. Also tested refitting slides 90/emails 30 down to the same 210-minute outcome, duplicate request replay, invalid merges, invalid buffers and atomic rejection when the pact cannot fit. No live inference was used for these checks.

After the single backend restart, all existing in-memory sessions expire. Start a fresh trial for the rehearsal.
