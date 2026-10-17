# Tasks on Trial: Project Story

**Your time. Their burden of proof.**

## Inspiration
Every planner asks the same question: *how do I fit everything in?* The honest answer is usually that you can't, and the app quietly lets you overbook yourself anyway. For "Flip the script" we reversed the burden of proof. In Tasks on Trial the calendar starts empty, and every task has to earn its place in court.

## What it does
- **The Docket:** you grant the court a time budget (say four hours) and choose when you're sharpest: morning, afternoon or night. Then you type your tasks in plain English. A scale shows your time against what the tasks demand. The judge asks only the questions it can't guess, such as "How many emails really need a reply?", and only what you confirm counts as evidence.
- **The Courtroom:** each task becomes an animated defendant. It argues for its minutes, the prosecution objects, and the judge rules **Approved**, **Reduced** or **Dismissed**. Trial formats run from Quick (one round) to Grand (three rounds of rebuttals).
- **Fighting back:** you can cross-examine a defendant, pardon it, call the judge for a better plan, or appeal. Tasks can even form **pacts**. A dismissed gym session partners with the run: run to the gym, then do strength. The commute disappears, two tasks become one, and the court re-tries the case.
- **The Sentence:** a real timetable in your chosen window, with the heaviest work first, minutes recovered, and a court order for each task (first move, steps, "done when"). **▶ Start** opens a focus room with a per-phase countdown.

## How we built it
- **Frontend (Carlos):** Next.js 16, React 19, TypeScript, Tailwind 4 and Framer Motion. The first designs came from v0. The courtroom, characters and scheduling of each testimony are hand-built. A typed adapter keeps the UI in sync with the API contract.
- **Backend (Gonzalo):** FastAPI with a **deterministic Python engine**, plus Nebius models (Nemotron for the trial voices, GLM for revisions). The language models write the defence, prosecution and witness answers. The engine applies the budget, deadlines, priorities and minimum versions of each task, then validates every plan. **The AI can argue, but it can't break the maths.**
- One shared JSON contract with revision checks for interrogations, appeals, pardons and pacts.

## Challenges we ran into
- **Keeping the AI honest:** early versions cut too much or invented facts. We introduced an evidence rule (only user-confirmed facts count) and reduce-before-dismiss logic.
- **Making the pact a real re-trial,** not a cosmetic change: the backend merges the tasks, drops the travel buffer and recomputes the whole day.
- Syncing two branches and a live API across a one-day build, including session restarts mid-demo (solved with a one-click *Reconvene*).

## Accomplishments we're proud of
- A planner that feels like a **game you negotiate with**, not a form you fill in.
- Pacts between tasks: two weak cases become one strong one, which no planner does.
- A clean split: LLM creativity for the voices, deterministic guarantees for the verdicts.

## What we learned
Saying "no" is the hardest part of planning, and turning it into theatre makes it easier. Using AI is most trustworthy when it explains decisions rather than makes them.

## What's next
- Calendar sync (Google or Outlook) so the sentence becomes real events.
- Calibration that learns how long your tasks actually take.
- Recurring cases, so habits defend their record over a week.

**Built with:** Next.js, React, TypeScript, Tailwind CSS, Framer Motion, v0, FastAPI, Python, Nebius AI Studio (Nemotron, GLM).
