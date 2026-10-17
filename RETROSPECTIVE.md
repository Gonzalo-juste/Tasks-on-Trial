# Retrospective: Tasks on Trial (Edinburgh AI Hackathon, 17 Oct 2026)

Theme "Flip the script". Team: Carlos (frontend, branch `frontend`) and Gonzalo (backend, branch `backend`).
Pitch line: *"Most planners ask how to fit everything in. We ask what deserves to get in."*

## How the idea changed
**Start (first hour):** "Shark Task" (tasks pitching for your time) merged with Gonzalo's "Task Tribunal" and the mentor's review into brief v3, **Tasks on Trial**. The thesis never changed: *the calendar starts empty and every task has to earn its place*. What changed was how it feels.

| Aspect | Brief v3 (morning) | Final product |
|---|---|---|
| Input | Fixed form, 09:00–18:00 day | Granted time budget, focus window (morning / afternoon / night), free-text capture with an instant parser, one question from the judge |
| Seeing the problem | Task list and total minutes | Animated scale: your time vs what tasks demand |
| Trial | Three verdict columns | Animated courtroom: queue, witness stand, defence vs prosecution in rounds, gavel, benches; Quick / Standard / Grand / Immediate formats; skip testimony |
| Star moment | Instagram confesses "I'm a break in disguise" and takes a 15-min break plea | **Gym + run pact**: two tasks ally, the commute disappears, real re-trial |
| Relations and pardons | Explicitly "not today" | Built; the pact became the centre of the demo |
| Cross-examination | Five fixed buttons | Questions depend on the verdict, free questions, re-ask on "No comment" |
| Output | Court Orders panel with checkboxes | Sentence: real timetable, first move per task, focus room with phase countdown, "Call the judge" to revise a plan |
| Engine | Planner over a time window | Budget + window, reduce-before-dismiss, refill, travel buffers, task merging |

**In short:** it went from a tool that gives verdicts to something you **negotiate with**. The planned "extras" (relations, pardons, rounds) became the most creative part. What stayed: Python decides, AI argues; the metric is minutes recovered.

## What it would need for people to actually use it
1. **Fit into a daily routine.** Under 60 s per trial; Immediate mode by default and the courtroom for hard days or appeals; a morning "court is in session" and an evening "was the sentence served?"; dismissed tasks go to tomorrow's docket, never lost.
2. **Integrations.** Import Google / Outlook calendars as fixed blocks and Todoist / Notion / Reminders as tasks; export the sentence as real events.
3. **Persistence and scale.** Accounts, a database, history; more than six tasks, recurring tasks, multi-day deadlines; configurable timezone and language (currently Europe/London and English).
4. **Close the loop.** Track done vs planned and wire up the existing calibration (`frontend/lib/calibration.ts`) so the judge learns how long your tasks really take; habits with a record ("precedents").
5. **Trust and control.** One-click override; a clear privacy story (tasks go to an LLM); lower latency (streaming, caching, deterministic defaults).
6. **Mobile first.** PWA, voice capture, widgets.
7. **Validate with real users first.** Pick one audience (students in exam season, freelancers, people who over-commit) and measure D1/D7 retention and % of sentences served.

Priority: (1) and (2) first, since without a daily habit and integrations nobody comes back; then (4).

## State at the end
- `frontend` last commit `9fe6ea4`; `backend` last commit `9381b76`; `main` only had the initial commit at the deadline (merge pending between the team).
- Docs: `frontend/BRIEF.md`, `frontend/docs/` (backend handoff, v0 prompt, pitch synced to the demo, project story).
- Lessons generalised into `../hackathon-playbook/06-lessons.md`.
