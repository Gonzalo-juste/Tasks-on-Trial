# Tasks on Trial: backend handoff (Gonzalo)

> **One line:** the calendar starts empty, and tasks must earn their place.
> The LLM argues and proposes. **Python decides what actually fits.**
> Full product brief: `frontend/BRIEF-TASK-TRIBUNAL.md`. Fixtures: `frontend/fixtures/*.json`.

## 0. Timeline for you
| Time | Deliverable |
|---|---|
| **10:40–11:00** | `POST /api/trial/run` live on `localhost:8000`. **Hard-coded** reply from `fixtures/demo-initial.response.json` with `provenance: "replay"`, plus CORS. Carlos plugs in against it. |
| 11:00–12:00 | Planner and validation in pure Python (section 4), with no LLM yet. Then the judge LLM call. |
| 12:00–12:30 | Pitch LLM call. Run the 8 test cases (section 7). Log latency. |
| **12:30 CHECKPOINT** | `action: "initial"` works end to end with Nebius. If not, ship `rule_fallback` (section 4.4). |
| 13:00–13:30 | `action: "interrogate"` and `action: "appeal"` |
| 13:30–14:30 | Review Carlos's frontend. Fix blockers. |
| 14:30–15:30 | Fixes, prompt tuning, test cases. Backup video by 15:00. **Freeze 15:30.** |

## 1. Stack and setup
- Python with **FastAPI + uvicorn** (suggested), on port **8000**.
- **Nebius Token Factory** is OpenAI-compatible, so use the `openai` Python SDK with Nebius's `base_url` and your key from `backend/.env`. **Never send the key, prompts or reasoning to the browser.**
- **CORS:** allow `http://localhost:3000`.
- Use **JSON mode / structured output** on the chosen model (see the Nebius docs on JSON output), then **validate semantically** in Python.
- **Models:** pick by measured latency. Use a strong model for the **judge** and a fast one for the **pitch and interrogation** calls. One model for everything is fine if it is more reliable.
- **Budget:** the initial request should take **under 20 s**, with a 25 s hard cap and at most 1 retry inside the cap.
- **Log server-side:** model, number of calls, tokens and latency. Return a small `meta` object (see the fixtures).

## 2. Contract: `POST /api/trial/run`
The backend is **stateless**. The frontend sends the full snapshot every time.

### Request
```json
{
  "request_id": "demo-1",
  "revision": 1,
  "action": "initial | interrogate | appeal",
  "day": {
    "date": "2026-10-17", "timezone": "Europe/London",
    "start": "15:00", "end": "16:00",
    "fixed_blocks": [{ "start": "HH:MM", "end": "HH:MM", "label": "..." }],
    "protected_blocks": [{ "start": "15:45", "end": "16:00", "label": "Breathing room" }]
  },
  "tasks": [{
    "id": "slides", "title": "Polish the slides", "duration_min": 45,
    "deadline_at": null,
    "requires": [],
    "category": "health | work | money | family | learning | other",
    "evidence": "A basic deck already exists. The title slide has a typo."
  }],
  "priorities": ["health", "work"],
  "forced_ids": [],
  "excluded_ids": [],
  "history": [{ "task_id": "slides", "kind": "pitch | answer | appeal | verdict", "text": "..." }],
  "interrogation": { "task_id": "slides", "question_type": "purpose | why_so_long | why_today | who_needs | minimal | free", "question_text": null },
  "appeal": { "task_id": "slides", "proposed_title": "Fix the title slide typo", "proposed_duration_min": 5, "proposed_steps": ["..."], "user_confirmed": true }
}
```
- `deadline_at` is RFC 3339 with an offset. Edinburgh is on BST today, so `+01:00`.
- `requires` lists other task IDs that must finish before this one starts.
- Tasks are capped at **6**. The demo uses 3.

### Response (200)
```json
{
  "request_id": "demo-1", "revision": 1, "status": "ok",
  "provenance": "live | rule_fallback | replay",
  "messages": [{ "task_id": "send | ... | judge", "kind": "pitch | answer | appeal | verdict", "text": "<= 240 chars" }],
  "interrogation_result": null,
  "decision": {
    "admitted": ["send", "walk"],
    "pending": [{ "task_id": "slides", "reason_code": "not_proven | no_fit | deadline | requires_unmet", "next_step": "..." }],
    "reason": "..."
  },
  "schedule": [{ "task_id": "send", "start": "15:00", "end": "15:10", "steps": ["..."] }],
  "free_min": 30,
  "protected_min": 15,
  "conflicts": [{ "code": "forced_no_fit | deadline_impossible | ...", "task_ids": ["..."], "message": "..." }],
  "meta": { "model_judge": "...", "model_tasks": "...", "llm_calls": 2, "latency_ms": 8400 }
}
```
- `interrogation_result` is only filled for `action: "interrogate"`:
  `{ task_id, question_type, answer, rating: "supported | evasive | contradiction", credibility: 0..1, proposal: { title, duration_min, steps } | null }`
- **Invariant:** every task that is not excluded appears exactly once, either in `admitted` or in `pending`.
- **Always echo** `request_id` and `revision`. The frontend ignores stale revisions.

### Errors
- **422:** invalid input (bad IDs, a `requires` cycle, non-positive duration, more than 6 tasks).
- **409:** the constraints are incompatible (for example, a forced task can never fit).
- **503:** AI unavailable and no fallback.
- Body: `{ "request_id", "revision", "error": { "code", "message", "task_ids" } }`
- **Never** turn a timeout into a fake AI answer. Use `rule_fallback` and label it as such.

## 3. What each action does
| Action | LLM calls | Then Python |
|---|---|---|
| `initial` | 1) **Pitch** (batch, fast model) → 2) **Judge** (strong model) | Planner places the judge's ranking. Returns the schedule. |
| `interrogate` | 1) **Interrogation** (fast model) | **No schedule change.** Returns the same schedule and decision as the snapshot implies, plus `interrogation_result`. The proposal waits for user confirmation. |
| `appeal` (`user_confirmed: true`) | 1) **Judge** again, with the updated task | Replace the task's title, duration and steps with the proposal, re-run the planner. |

## 4. Planner (pure Python, deterministic)
1. **Validate** (422 on failure): unique IDs, `requires` reference existing IDs, **no cycles** (DFS), `duration_min > 0`, `start < end`, and blocks inside the window and not overlapping each other.
2. **Free intervals** = window − fixed blocks − protected blocks.
3. **Order** = the judge's `ranking` (admitted candidates only, never `excluded_ids`), then reordered topologically so requirements come first.
4. **Place greedily**, earliest slot first. Tasks are **indivisible**.
   - A task cannot start before all its `requires` have **ended**.
   - It must end on or before `deadline_at`.
   - If it does not fit, it goes to `pending` with `no_fit`, `deadline` or `requires_unmet`.
   - Anything the judge marked `not_proven` goes to `pending` with `not_proven` and is never placed.
5. **`forced_ids`** are placed first. If one cannot fit, return **409** with a `forced_no_fit` conflict. **No judge creates minutes.**
6. **`free_min`** = window − fixed blocks − scheduled work. This includes protected time. **`protected_min`** reports the protected time separately.
7. **Fallback** (`provenance: "rule_fallback"`): if the LLM fails, rank by deadline first, then by priority order, then by shortest duration. Write a templated verdict text that says it is a rule-based fallback.

## 5. Prompts (starting point, tune them)

### 5.1 Pitch (batch, fast model)
```
SYSTEM:
You voice tasks on trial. The user's calendar starts EMPTY; each task must earn its place.
Each task speaks in first person with a distinct, playful personality that fits what it is
(e.g. taxes = grumpy accountant, gym = intense coach). British courtroom flavour is welcome.

Hard rules:
- Use ONLY facts given in the task's title, duration, deadline, category and evidence.
- NEVER invent deadlines, penalties, benefits or numbers.
- Each pitch answers: what happens if I'm not done today, what evidence exists, my minimum useful version.
- Max 240 characters per pitch.
Return JSON only: {"messages":[{"task_id":"...","kind":"pitch","text":"..."}]}

USER:
Day window, priorities and tasks: <JSON snapshot>
```

### 5.2 Judge (strong model)
```
SYSTEM:
You are the judge in "Tasks on Trial". The calendar starts empty and does NOT need to be filled.
The burden of proof is on each task. Rhetoric earns nothing; only evidence, impact and urgency count.
Weigh: (1) evidence of impact if not done today, (2) real urgency from deadline_at, (3) the user's
stated priority order. Do NOT schedule. Do NOT invent time. Python will place tasks.
You may declare a task "not_proven" and leave its time free. That is a good outcome.
Respect excluded_ids (never consider them) and forced_ids (must be admitted).

Return JSON only:
{
  "ranking": ["task ids admitted, best first"],
  "not_proven": ["task ids"],
  "reasons": {"task_id": "<=120 chars"},
  "steps": {"task_id": ["2-4 concrete first steps"]},
  "next_steps": {"task_id": "one concrete next step for pending tasks"},
  "verdict_text": "<=240 chars, dry British judge tone"
}

USER:
Snapshot: <JSON>   Pitches: <messages JSON>
```

### 5.3 Interrogation (fast model)
```
SYSTEM:
The user is cross-examining one task. The task answers in character, in first person, max 240 chars.
It may ONLY use facts in its own data and the trial history. If it has no evidence, it must say
"No comment." (or similar) rather than invent anything.
Question types:
- purpose: what happens if you're not done today?
- why_so_long: break yourself into steps with minutes; if they add up to less, admit it.
- why_today: cite a real deadline from the data, or admit there is none.
- who_needs: who benefits; could it be delegated?
- minimal: propose your smallest useful deliverable.
- free: answer the user's question.

Then, as an impartial clerk, rate the answer:
"supported" (backed by the data), "evasive" (no evidence), "contradiction" (conflicts with the data).
If the answer shows the scope can shrink, include a proposal that is a REAL smaller deliverable
(different title and steps). "Same thing but faster" is NOT a valid proposal.

Return JSON only:
{"answer":"...","rating":"supported|evasive|contradiction","credibility_delta":-0.3..0.3,
 "proposal":{"title":"...","duration_min":5,"steps":["..."]} | null}

USER:
Task: <task JSON>   Question: <type + text>   History: <messages for this task>
```
- Credibility starts at 0.5. Python clamps `credibility + delta` to between 0 and 1. Max 3 questions per task (the frontend enforces this too).

## 6. Expected demo result (`fixtures/demo-initial.*`)
- **Window:** 15:00–16:00, with 15:45–16:00 protected.
- **Expected schedule:** `send` 15:00–15:10 and `walk` 15:10–15:30. `slides` (45 min) is pending, since only 15 minutes of unprotected time remain.
- `free_min` = 30 and `protected_min` = 15.
- After interrogating `slides` with `why_so_long`, it proposes a 5-minute version. After an `appeal` with `user_confirmed`, it is scheduled 15:30–15:35 and `free_min` = 25.

## 7. Test cases (run them before 12:30, and again at 14:30)
1. **Success:** the demo fixture produces the schedule above.
2. **No fit:** a task longer than the free time goes to `pending` with `no_fit`.
3. **Deadline:** a task that cannot end before `deadline_at` goes to `pending` with `deadline`.
4. **Dependency:** B `requires` A, so B is placed after A ends. If A is pending, B gets `requires_unmet`.
5. **Cycle:** A requires B and B requires A, so the API returns 422.
6. **Impossible force:** a forced task can never fit, so the API returns 409 with `forced_no_fit`.
7. **Bad JSON from the LLM:** one retry, then `rule_fallback`.
8. **Timeout over 25 s:** `rule_fallback`, never a fake "live" answer.

**Interrogation cases:** a `supported` answer, a "No comment" answer (`evasive`), and a `contradiction` (the task claims a deadline that does not exist).

## 8. Git
Work on the `backend` branch, in `backend/` only. Run `git pull origin main` before the review (13:30) and before implementing (14:30). We agree the merge to `main` together.
