# Tasks on Trial: product brief (v3, 10:40)

> **Merged version:** our brief v2 + the mentor's review + Gonzalo's report ("TASK TRIBUNAL 2"). This file replaces every earlier brief, note and idea list.
> Backend handoff: `docs/GONZALO-BACKEND.md` · v0 prompt: `docs/V0-PROMPT.md` · Demo fixtures: `fixtures/*.json`

## 1. The challenge
**Edinburgh AI Hackathon, 17 Oct 2026. Theme: "Flip the script".**
> Take something we all assume has to work a certain way and turn it on its head. Pick something familiar, challenge the assumption behind it and build a completely different way of doing things. Don't just make it better: flip the whole idea.

- **Judging:** creativity. The sponsors said **"go wild"**.
- **Models:** any Nebius Token Factory model.
- **Deadline:** product **and** pitch ready at **16:00**. Presentations run 16:00–17:00.

## 2. The idea
**Pitch line:** *"Most planners ask how to fit everything in. We ask what deserves to get in."*
**Tagline:** *"The calendar starts empty. Your tasks must earn their place."*

- **The assumption:** every task on your list is an obligation, and a planner's job is to squeeze them all in.
- **The flip:** your time is yours by default. Each task stands trial. It has to prove its **need**, its **scope** and its **duration** against a **prosecutor**. It can be approved, cut down, dismissed, or replaced by something that serves the real need better.
- **The visible result:** **minutes recovered**, plus a valid day with visible free gaps. The app does **not** try to fill the day.

## 3. Cast and separation of powers
| Role | Does | Never |
|---|---|---|
| **User** | Confirms facts, durations, obligations and reduction permissions. Cross-examines tasks. Accepts or rejects plea deals. | Creates extra time by preference |
| **Defense** (each task, in character) | Argues for itself, with a minimum viable plan | Sets its own verdict or invents facts |
| **Prosecutor** | Challenges need, duration and alternatives. Concedes valid defenses. | Dismisses a mandatory task, or invents facts or user feelings |
| **Python engine** | Validates proposals, applies the rules, places tasks and computes the metrics. **It is the source of truth.** | Hides a conflict |
| **Judge** | Narrates the final result in a dry British tone | Contradicts the engine |

The defense, prosecutor and judge are **fields in one structured LLM response**, not separate agents.

## 4. Verdicts and schedule status
- **APPROVED:** the confirmed scope and duration are kept.
- **REDUCED:** a smaller deliverable that the user authorised, either a smaller scope or a replacement. It has a new title and steps, and it is never below `minimum_min`.
- **DISMISSED:** zero minutes today. That means "not justified today", not "worthless".

Each task also has a **schedule status**, independent of its verdict:
- `SCHEDULED`
- `PENDING`: approved but it does not fit. It keeps its minutes and is **not** counted as recovered.
- `NOT_APPLICABLE`: the task was dismissed.

If a **mandatory** task does not fit, the response returns `status: "conflict"`. The engine never disguises it as a dismissal.

## 5. The metric
**Minutes recovered** = original confirmed minutes − final approved minutes, over the same tasks.
- A replacement keeps the original task ID and is counted once.
- Pending minutes stay in the approved total.
- **Free capacity** (usable window − approved work) is shown separately and is a different number.

**Demo:** 405 → 285 approved = **120 recovered** (free capacity 195). After the appeal: 300 approved = **105 recovered** (free capacity 180).

## 6. Cross-examination (user-driven)
When the prosecutor is done, **the user can take over the prosecution**. Click a task, then pick a question:

| Button | What it tests |
|---|---|
| "What are you for?" | The need. This is where it can reveal a hidden need. |
| "Why so long?" | The duration. The task has to break itself into steps with minutes. |
| "Why today?" | The urgency. It must cite a real deadline or fact. |
| "Who needs you?" | The beneficiary, and whether it could be delegated |
| "What's your smallest version?" | The scope |
| Free question | Anything else |

- The task answers in character, using **only confirmed facts**. With no evidence it says **"No comment."**
- A clerk rates each answer as ✅ supported, ⚠️ evasive or ❌ contradiction, which moves a **credibility meter**.
- The answer can carry a **plea deal**: a real smaller deliverable or a replacement that serves the need.
- **Accept plea** triggers the **appeal**.
- Limits: max 3 questions per task. Interrogating **never** changes the schedule by itself.

## 7. Underlying needs and the appeal
- A task may be the means to an end: scrolling to rest, polishing to feel confident. The model may **suggest** a need, labelled *suggested* until the user confirms it. Rest and leisure are never penalised for not being productive.
- **Appeal:** one per run. It brings a new user fact and/or an accepted replacement. Only the affected task is re-judged, the whole schedule is rebuilt, and the minutes are never double-counted.
- **Demo beat:** Instagram is DISMISSED. The user asks it "What are you for?" and it confesses: *"I'm a break in disguise."* It offers a plea of a 15-minute screen-free break. The user accepts and adds the fact "I haven't taken a break in six hours". The appeal makes it REDUCED · 15, and recovered minutes go from 120 to 105. **The app gave the user rest instead of taking it away.**

## 8. Scope
| Tier | What | When |
|---|---|---|
| **1. MVP** | Setup form, `/run` (defense + prosecution + verdicts in one call), Python planner, 3 verdict columns, minutes recovered, timeline, replay mode | **12:30 checkpoint** |
| **2.** | `/interrogate` + `/appeal` (plea deal → appeal), suggested needs | 12:45–13:30 |
| **3. Only if all green** | `/init` (LLM estimates durations and personas, user confirms), "Standard" mode with a separate prosecutor pass | — |
| **Not today** | Relations −3/+3, betrayals, precedents, drag-and-drop, pardons, rule changes mid-trial, login, DB, calendar sync, generated images | — |

## 9. Timeline (build 10:00–15:30)
| Time | Carlos | Gonzalo | Checkable result |
|---|---|---|---|
| 10:40–11:00 | v0 design; app runs on fixtures | Schemas + `/run` returning `fixtures/run.response.json` + CORS | Frontend renders the fixture from the real endpoint |
| 11:00–11:45 | Courtroom, verdict columns, timeline | Planner + Nebius client + validation | **First real call from the UI** |
| 11:45–12:30 | Wire real data, loading and error states | Conflict cases and fallback | Full loop with prosecutor and metric |
| **12:30** | Checkpoint + short lunch | Checkpoint + short lunch | Go / cut extras |
| 12:45–13:30 | Cross-examine panel + plea deal | `/interrogate` + `/appeal` | Plea → appeal without double counting |
| 13:30–14:30 | **Review** Gonzalo's API and errors, write the pitch script | **Review** Carlos's states and copy, check the numbers | Short defect list by severity |
| 14:30–15:30 | Fixes and integration. **Backup video by 15:00.** | Fixes, prompt tuning, test cases | Release candidate |
| **15:30** | **Freeze.** Two timed rehearsals | Clean start, submission | Everything ready by 16:00 |

**Cut rules:** if the loop fails at 12:30, drop interrogation, appeal and effects. At 15:30 only demo-blocking fixes are allowed.

## 10. Demo (3 min, prepared case, announced as example data)
1. **0:00–0:20** *"What if every task had to prove it deserves your time?"* Show the list: 405 minutes, empty calendar.
2. **0:20–0:40** Confirm the day (09:00–18:00, lunch 13:00–14:00). The user marks maths as mandatory and authorises reductions.
3. **0:40–1:15** The trial: the emails' defense and the prosecutor's objection. *"Five urgent emails justify fifteen minutes, not an hour."*
4. **1:15–1:45** The verdict: 2 approved, 2 reduced, 1 dismissed. **120 minutes recovered.** The timeline shows free gaps.
5. **1:45–2:25** Cross-examine Instagram: "What are you for?" → *"I'm a break in disguise."* Accept the plea and add the new fact. The appeal makes it a screen-free break of 15 minutes, and **105 recovered**.
6. **2:25–2:45** *"Nebius argues; Python guarantees the minutes add up."*
7. **2:45–3:00** *"Your time is yours. Make your tasks earn it."*

**Fallback:** a replay labelled as replay, then the video.

## 11. Roles
- **Carlos** (`frontend/`, branch `frontend`): the UX (setup, courtroom, sentence), session state, confirmations, loading and error states, a typed client against the contract, fixtures, the pitch script, the replay and the video.
- **Gonzalo** (`backend/`, branch `backend`): Pydantic schemas, routes, the Nebius client, the planner, validation, metrics and the choice of model by measured latency. He also verifies the pitch numbers.
- **Both:** freeze the contract before building dependent screens. Changing a field means updating the schema, the fixture and the consumer together. Run `git pull origin main` before the review and before the final integration. The merge to `main` is agreed together.
