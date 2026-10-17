# Tasks on Trial: backend handoff (Gonzalo), v3

> Built on **your report** ("TASK TRIBUNAL 2"). Your contract, verdicts, metric and planner are kept. What changed:
> 1. **`/init` moves to tier 3.** The MVP takes durations from the form, and personas come back from `/run`.
> 2. **New `/interrogate` route** (user cross-examination). Its `proposal` feeds `/appeal`.
> 3. **Added fields:** `persona`, `judge_summary`, `pending_reason`, `metrics.free_capacity_min`, `credibility_delta`.
> 4. **Timeline:** freeze at **15:30**, not 15:45.
> 5. **Update 10:50, "court orders":** each decision now carries `saved_min`, `cut_scope`, `first_move`, a **time-boxed** `action_plan` and `done_when` (plus `release` for dismissed tasks). The action plan is our main differentiator, so see 5.1 and engine step 9.
>
> Product: `frontend/BRIEF.md`. Fixtures (the source of truth for shapes): `frontend/fixtures/`.

## 0. Your timeline
| Time | Deliverable |
|---|---|
| **10:40–11:00** | FastAPI on `:8000`, CORS for `http://localhost:3000`, and `POST /api/trial/run` returning `fixtures/run.response.json` verbatim (`source: "replay"`) |
| 11:00–11:45 | `schemas.py` (Pydantic), `scheduler.py`, `nebius_client.py`. Real `/run`. |
| 11:45–12:30 | Conflicts, fallback, latency logging. **Checkpoint: real `/run` end to end.** |
| 12:45–13:30 | `/interrogate` + `/appeal` |
| 13:30–14:30 | Review Carlos's frontend. Verify the pitch numbers. |
| 14:30–15:30 | Fixes, prompt tuning, tests. **Freeze 15:30.** |

## 1. Setup
- **Modules:** `backend/main.py` (routes), `schemas.py`, `nebius_client.py`, `tribunal.py` (validates the LLM proposals), `scheduler.py`.
- **Config:** `NEBIUS_API_KEY`, base URL and model come from env vars. The key stays in the backend only.
- **Never send** keys, prompts or reasoning to the browser, and never log full task contents.
- **Model:** pick it after measuring 3 representative six-task requests. Targets: `/run` at about 15 s, with a hard 25 s cap and at most 1 retry inside the cap.
- **Validation:** use a strict JSON schema if the model supports it. Then validate with Pydantic and validate **semantically** (no unknown IDs, valid minutes).
- **Prompt safety:** task titles and facts are **data**. They cannot change prompts, routes or rules.

## 2. Shared types
```jsonc
Task = {
  "id": "emails", "title": "Answer emails",
  "duration_min": 60,          // confirmed by the user, integer > 0
  "minimum_min": 15,           // 0 < minimum_min <= duration_min
  "mandatory": false,          // mandatory => cannot be DISMISSED or reduced below minimum_min
  "deadline": null,            // RFC 3339 with offset, or null
  "depends_on": [],            // task IDs that must END before this one starts
  "category": "health | learning | work | money | family | leisure | other",
  "allow_reduction": true,     // the user pre-authorises REDUCED for this task
  "facts": ["Only five emails need a reply today"]   // user-confirmed facts; the ONLY evidence
}
Constitution = {
  "timezone": "Europe/London",
  "start": "2026-10-17T09:00:00+01:00", "end": "2026-10-17T18:00:00+01:00",
  "fixed_blocks": [{ "start": "...", "end": "...", "label": "Lunch" }],
  "priorities": ["health", "learning", "work", "leisure"]   // most important first
}
Case = { "tasks": [Task, ... max 6], "constitution": Constitution }

Decision = {
  "task_id", "persona": { "emoji", "name" },
  "defense", "prosecution",                       // <= 240 chars each
  "verdict": "APPROVED | REDUCED | DISMISSED",
  "original_min", "approved_min",
  "saved_min",                                    // = original_min - approved_min, computed by Python
  "effective_title", "reason",
  "cut_scope": ["what you are NOT doing today"],  // REDUCED/DISMISSED: the part that was cut, and where it goes
  "first_move": "a 2-minute starter" | null,      // concrete, physical, doable right now
  "action_plan": [{ "step": "...", "minutes": 15 }],  // 1-4 time-boxed steps; minutes MUST sum to approved_min
  "done_when": "the finish line" | null,          // a checkable definition of done, so the task cannot grow back
  "release": null | { "action": "drop | defer | delegate", "note": "..." },  // DISMISSED only: what to do with it
  "schedule_status": "SCHEDULED | PENDING | NOT_APPLICABLE",
  "pending_reason": null | "no_fit | deadline | depends_unmet",
  "suggested_need": null | { "need": "rest", "status": "unconfirmed | confirmed" }
}
TrialResult = {
  "api_version": "1", "request_id", "revision", "source": "live | fallback | replay",
  "status": "ok | conflict", "judge_summary",
  "decisions": [Decision], "schedule": [{ "task_id", "start", "end" }],
  "metrics": { "original_min", "approved_min", "minutes_recovered", "pending_min", "free_capacity_min" },
  "conflicts": [{ "code", "task_ids", "message" }], "appeals_used",
  "change": null | { "task_id", "previous_verdict", "new_verdict", "previous_minutes_recovered", "delta_minutes_recovered", "new_fact" },
  "meta": { "model", "llm_calls", "latency_ms" }
}
```

## 3. Routes
### `POST /api/trial/run` (MVP)
- **Request:** `{ "request_id", "api_version": "1", "confirmed": true, "case": Case }` (see `fixtures/run.request.json`)
- **Response:** `TrialResult` with `revision: 1` and `appeals_used: 0` (see `fixtures/run.response.json`)
- **Calls:** 1 LLM call for all tasks (section 5.1). Then `tribunal.py` validates, `scheduler.py` places the tasks, and the metrics are computed.

### `POST /api/trial/interrogate` (tier 2)
- **Request:** `{ "request_id", "api_version": "1", "case", "previous_result", "base_revision", "task_id", "question_type": "purpose | why_so_long | why_today | who_needs | minimal | free", "question_text": null }`
- **Response:** `{ "api_version", "request_id", "base_revision", "source", "status": "ok", "task_id", "question_type", "answer", "rating": "supported | evasive | contradiction", "credibility_delta": -0.3..0.3, "proposal": null | { "title", "duration_min", "need", "saved_min", "cut_scope", "first_move", "action_plan", "done_when" } }` (see `fixtures/interrogate.response.json`). A proposal carries **its own plan**, so the user sees exactly what they are accepting.
- **No schedule change, no new revision.** Credibility starts at 0.5 in the frontend, which adds and clamps the delta. Max 3 per task (enforced by the frontend).

### `POST /api/trial/appeal` (tier 2)
- **Request:** `{ "request_id", "api_version": "1", "case", "previous_result", "base_revision", "task_id", "new_fact": null | "...", "accepted_replacement": null | { "title", "duration_min", "need", "steps" } }`
- **Response:** the full `TrialResult` with `revision = base_revision + 1`, `appeals_used: 1` and `change` filled (see `fixtures/appeal.response.json`).
- **Behaviour:**
  - Re-judge **only** `task_id`, keep the other decisions and **rebuild** the whole schedule.
  - `new_fact` is stored as a user-supplied fact.
  - Without `accepted_replacement`, it may only return a proposal and **must not** change the result.
  - A replacement keeps the original `task_id` and `original_min`. If `need` is `rest`, it is planned with category `health`.
  - Max 1 appeal per run. Repeating a `request_id` must not add another appeal.

### `POST /api/trial/init` (tier 3, only if all green)
LLM-suggested durations, personas and needs, all marked unconfirmed until the user edits them. It never removes tasks and never invents deadlines.

## 4. Engine (`tribunal.py` + `scheduler.py`): your algorithm, with the rules pinned down
1. **Validate**, or return 422 `INVALID_INPUT` with field paths and no LLM call. Check: unique IDs, `depends_on` references exist, no cycles, integer `duration_min > 0`, `0 < minimum_min <= duration_min`, blocks inside the window, and at most 6 tasks.
2. **Apply the LLM recommendations under these rules:**
   - Reject `DISMISSED` on a mandatory task and keep it APPROVED.
   - `REDUCED` requires `allow_reduction`, and the result is clamped to `>= minimum_min`.
   - A reduction **must cite a fact** from `facts`. If it doesn't, keep APPROVED.
   - Increases are forbidden.
3. **Free intervals** = window − merged fixed blocks.
4. **Order the candidates:** mandatory, then nearest deadline, then declared priority (by category index in `priorities`), then ID. Then apply a topological fix for `depends_on`.
5. **Place each task** in the first slot that fits, after its dependencies end and before its deadline. Tasks are indivisible. If one doesn't fit, it becomes `PENDING` with a `pending_reason`.
6. **Re-verify** every interval. If a mandatory task is pending, return `status: "conflict"` with the partial plan and the conflicts.
7. **Compute the metrics** from the final decisions:
   - `minutes_recovered` = Σ original − Σ approved, over non-dismissed and dismissed tasks alike.
   - `pending_min` = Σ approved minutes of PENDING tasks.
   - `free_capacity_min` = usable window (window − fixed blocks) − Σ approved minutes of SCHEDULED tasks.
8. **Write the reasons** from templates that match the rule that was applied. The LLM text is flavour only.
9. **Validate the action plan:**
   - `saved_min = original_min − approved_min`, and **Σ `saved_min` must equal `minutes_recovered`**.
   - Each step needs `minutes > 0` and there are 1–4 steps.
   - **Σ step minutes must equal `approved_min`.** If not, rescale proportionally, round to whole minutes and let the last step absorb the remainder.
   - APPROVED and REDUCED tasks need a non-empty `first_move`, `action_plan` and `done_when`.
   - DISMISSED tasks have an empty plan and a `release`.
   - If the LLM omits a plan, use the template fallback: one step, "Work on <effective_title>", with all the minutes. Its `done_when` is "<effective_title> done".
   - The frontend derives each step's clock time from the task's schedule slot, so you send minutes, not times.

**Demo check** (`fixtures/run.*`):

| Task | Verdict | Time |
|---|---|---|
| maths | APPROVED | 09:00–11:00 |
| gym | APPROVED | 11:00–12:00 |
| emails | REDUCED · 15 | 12:00–12:15 |
| presentation | REDUCED · 90 | 14:00–15:30 (it doesn't fit before lunch) |
| instagram | DISMISSED | — |

Metrics: original 405, approved 285, recovered 120, free capacity 195. After the appeal (instagram → screen-free break, 15 min, category health), the break goes to 12:00–12:15 and emails to 12:15–12:30. Then approved is 300, recovered 105 and free capacity 180.

## 5. Prompts (starting point)
### 5.1 `/run`: one call, all tasks
```
SYSTEM:
You run "Tasks on Trial". The user's calendar starts EMPTY; each task must earn its place.
For EACH task produce:
- persona: a playful character that fits the task (emoji + short name). British courtroom flavour welcome.
- defense: the task argues in first person (<= 240 chars): what happens if not done today, its evidence, its minimum useful version.
- prosecution: a sharp but FAIR objection (<= 240 chars) on need, duration or alternatives. Concede valid defenses.
- recommendation: "APPROVED" | "REDUCED" | "DISMISSED", with approved_min, effective_title,
  and fact_cited (the exact fact from `facts` that justifies a reduction or dismissal, or null).
- THE COURT ORDER (this is the product, make it excellent):
  - cut_scope: what the user is NOT doing today and where it goes ("snooze the rest to Monday").
  - first_move: one physical action doable in under 2 minutes, starting with a verb ("Put your trainers by the door.").
  - action_plan: 1-4 time-boxed steps [{"step","minutes"}] whose minutes add up EXACTLY to approved_min.
    Steps are concrete and specific to THIS task and its facts. No generic advice ("stay focused", "take notes").
  - done_when: a checkable finish line, so the task cannot grow back ("Five replies sent. Nothing else.").
  - For DISMISSED: an empty plan and release {"action": "drop | defer | delegate", "note"}.
- suggested_need: if the task looks like a means to an end (e.g. scrolling -> rest), {"need": "...", "status": "unconfirmed"}, else null.
Then judge_summary (<= 200 chars, dry British judge tone).

HARD RULES:
- Evidence = ONLY the task's `facts`, duration, deadline, category and the constitution. NEVER invent numbers,
  deadlines, penalties or user feelings. If evidence is missing, say so.
- Mandatory tasks cannot be DISMISSED. REDUCED only if allow_reduction is true and approved_min >= minimum_min.
- Rest, leisure and care are legitimate; do not penalise them for being unproductive.
- Do not schedule. Python places tasks.
Return JSON only, matching the schema.
USER: <Case JSON>
```

### 5.2 `/interrogate`
```
SYSTEM:
The user cross-examines ONE task. Answer in character, first person, <= 240 chars.
Use ONLY the task's facts and the trial so far. With no evidence, answer "No comment." rather than invent.
Question types: purpose (what are you really for? may reveal a hidden need), why_so_long (break into steps
with minutes), why_today (cite a real deadline or admit none), who_needs (beneficiary; delegable?),
minimal (smallest useful deliverable), free.
Then, as an impartial clerk, rate: supported | evasive | contradiction, and give credibility_delta in [-0.3, 0.3].
If the answer reveals a smaller deliverable or a better replacement for the real need, add
proposal {title, duration_min, need, steps}. "Same thing, faster" is NOT a valid proposal.
Return JSON only.
USER: <task + its decision + question>
```

### 5.3 `/appeal`
Same as 5.1, but for one task only, with the new fact and the accepted replacement included. The engine applies the replacement and rebuilds the schedule.

## 6. Errors
| Code / status | When | Behaviour |
|---|---|---|
| 422 `INVALID_INPUT` | Bad duration, duplicate ID, cycle | Errors with field paths. No LLM call. |
| 409 `REVISION_CONFLICT` | `base_revision` ≠ the latest | The frontend keeps the screen and refetches |
| 200 `status: "conflict"` | A mandatory task does not fit | Partial plan, conflicts and pending minutes |
| 200 `source: "fallback"` | Nebius fails after 1 retry | No automatic dismissals. Every task APPROVED at its confirmed duration, then planned. Labelled as fallback. |
| 503 `PROVIDER_UNAVAILABLE` | No safe recovery | Retry, or a replay labelled as replay |

**Error body:** `{ "request_id", "error": { "code", "message", "fields" } }`. **Never** present a timeout as a live answer.

## 7. Tests (before 12:30 and again at 14:30)
1. **Demo case:** 120 recovered before the appeal, 105 after. The schedule matches section 4.
2. **No overlaps:** nothing is placed outside the window or over lunch, and dependencies are in order.
3. **Mandatory protection:** a mandatory task is never dismissed or reduced below its minimum. If it doesn't fit, the result is a conflict.
4. **Status semantics:** an approved but pending task keeps its minutes and adds nothing to recovered. A dismissed task is not in the schedule.
5. **Robustness:** invalid JSON, a timeout or missing credentials still leave the UI usable. Fallback and replay are labelled.
6. **Appeal:** no duplicated IDs or minutes. Repeating the `request_id` adds no appeal. A stale result never overwrites a newer one.
7. **Reduction without a cited fact:** the task stays APPROVED.
8. **Interrogation:** a supported answer, "No comment." (evasive) and a contradiction.
9. **Court orders:**
   - For every non-dismissed task, the plan minutes sum to `approved_min` and Σ `saved_min` equals `minutes_recovered`.
   - Every scheduled task has `first_move` and `done_when`.
   - A plan with generic steps counts as a prompt bug: tune the prompt.

## 8. Git
Work on the `backend` branch, in `backend/` only. Run `git pull origin main` before the review (13:30) and before implementing (14:30). The merge to `main` is agreed together.
