# v0 prompt: Tasks on Trial (v3)

Paste the block below into v0 as the first prompt. Iterate with short follow-ups; don't regenerate everything.

---

```
Build a single-page web app called "Tasks on Trial" with Next.js (App Router), TypeScript, Tailwind and shadcn/ui.

CONCEPT
Most planners ask how to fit everything in. This one flips it: the calendar starts EMPTY and every task stands
trial in a British courtroom. Each task defends itself, a prosecutor objects, and a judge rules:
APPROVED, REDUCED (smaller scope or a better replacement) or DISMISSED (zero minutes today).
The user can cross-examine any task and accept a "plea deal". The hero metric is MINUTES RECOVERED.

ONE PAGE, THREE STAGES (a top stepper: 1 Docket → 2 Courtroom → 3 Sentence; all on one route)

Header (always visible): logo "Tasks on Trial", tagline "The calendar starts empty. Your tasks must earn their place.",
a huge animated counter "Minutes recovered: 120" with a smaller "Free capacity: 195 min" under it,
and a source badge: "Live · Nebius" / "Fallback" / "Replay".

Stage 1, "The Docket" (setup):
- The day: start/end time, plus a "fixed blocks" list (e.g. Lunch 13:00–14:00) with add/remove rows.
- Priorities: an ordered list of categories (Health, Learning, Work, Money, Family, Leisure) with up/down buttons.
- Tasks (max 6), one card each with: title, duration (min), minimum (min), "Mandatory" switch,
  "Allow reduction" switch, category select, optional deadline time, optional "depends on" multi-select,
  and a "Facts" list (add short confirmed facts as chips, e.g. "Only five emails need a reply today").
- Show the total requested minutes ("405 min requested") and an empty-calendar preview.
- Buttons: "Load demo case" and the primary "Start the trial" (gavel icon).

Stage 2, "The Courtroom":
- One row per task: persona emoji + name, then a DEFENSE speech bubble (left) and a PROSECUTION bubble (right,
  with a red "Objection!" tag that pops in once). Text appears with a short typewriter effect;
  a "See the verdict" button skips all animation.
- The judge's bench at the bottom (👨‍⚖️ in a wig) shows judge_summary.

Stage 3, "The Sentence":
- Three columns: APPROVED (green ✓), REDUCED (amber ✂️), DISMISSED (red ✗). Each card shows
  the effective title, "original → approved" minutes (e.g. "60 → 15 min", with a strikethrough on the original),
  a big green "SAVED 45 MIN" badge whenever saved_min > 0 (this proves the value of REDUCED; make it prominent),
  the reason, a "Not today" list (cut_scope, struck through), and a credibility meter (starts at 50%).
  DISMISSED cards show the release note ("Drop", "Defer" or "Delegate") instead of a plan.
- "COURT ORDERS" panel (the core of the product, below the columns or as a tab next to the timeline):
  the day as an executable itinerary, in schedule order. For each scheduled task:
  the time slot, then a highlighted "First move" line (⚡ + first_move), then the action plan as a checklist where
  each step shows its own clock time, computed from the slot start plus the cumulative minutes
  (e.g. "12:00–12:03 Star the five urgent emails", "12:03–12:13 Reply to each one..."), then
  "Done when: ..." and a "Saved 45 min" chip. The checkboxes are clickable and a progress bar per task fills up.
  Buttons: "Copy my orders" (copies the itinerary as plain text/Markdown) and "Print".
  A card can also carry a "suggested need" chip (e.g. "Need: rest · suggested").
  A PENDING task (approved but does not fit) uses a distinct icon (⏳) and the text "Approved · no slot today",
  never just a different colour.
- Timeline (right side): the day from start to end, with scheduled tasks (solid, by category),
  fixed blocks (striped, labelled) and FREE gaps (dashed outline, labelled "Free"). The app does not fill the day.
- A red conflicts banner if status is "conflict".
- Each card has a "Cross-examine" button that opens a side sheet:
  5 question buttons: "What are you for?", "Why so long?", "Why today?", "Who needs you?",
  "What's your smallest version?", plus a free-text question. Max 3 questions per task (3-dot counter).
  The answer appears as the task's bubble with a rating badge: ✅ Supported / ⚠️ Evasive / ❌ Contradiction,
  and the credibility meter moves by credibility_delta.
  If there is a proposal, show a "Plea deal" card: new title, "45 → 15 min", "Saved 30 min", the need,
  the first move, the time-boxed plan and "Done when",
  an optional "Add a new fact" input, and the buttons "Accept plea" / "Reject".
  "Accept plea" calls appeal. Only 1 appeal per run, so disable it after use.
  After the appeal, animate the change: the card moves column (e.g. DISMISSED → REDUCED), the counter
  animates 120 → 105, and a small "Change" note shows the previous and new verdict.

STATES
idle, loading (lock inputs, "The court is deliberating..." shimmer), success, error
(a friendly message + "Retry" + "Use replay"). Ignore responses whose revision is older than the latest.
Show "Replay" or "Fallback" clearly whenever the source is not "live".

STYLE
"Go wild" but readable: a modern British courtroom. Deep navy and mahogany, brass/gold accents,
cream paper cards, serif headings (Playfair Display) with a clean sans body. A gavel animation when
the verdict lands; keep all motion short and skippable. Responsive: columns stack on mobile.

DATA AND API
All state in React (no auth, no database). Create /lib/types.ts with the types below and /lib/api.ts with
run(), interrogate() and appeal(), which POST JSON to `${process.env.NEXT_PUBLIC_API_URL}/api/trial/run`,
`/api/trial/interrogate` and `/api/trial/appeal`. If NEXT_PUBLIC_USE_MOCK === "true", return the mock data
from /lib/mocks.ts after a 1.5 s delay instead. Send the full case each time (the backend is stateless):
appeal and interrogate also send previous_result and base_revision.

type Category = "health"|"learning"|"work"|"money"|"family"|"leisure"|"other";
interface Task { id: string; title: string; duration_min: number; minimum_min: number; mandatory: boolean;
  deadline: string | null; depends_on: string[]; category: Category; allow_reduction: boolean; facts: string[] }
interface Constitution { timezone: string; start: string; end: string;
  fixed_blocks: { start: string; end: string; label: string }[]; priorities: Category[] }
interface Case { tasks: Task[]; constitution: Constitution }
type Verdict = "APPROVED"|"REDUCED"|"DISMISSED";
interface PlanStep { step: string; minutes: number }
interface Decision { task_id: string; persona: { emoji: string; name: string }; defense: string; prosecution: string;
  verdict: Verdict; original_min: number; approved_min: number; saved_min: number; effective_title: string; reason: string;
  cut_scope: string[]; first_move: string | null; action_plan: PlanStep[]; done_when: string | null;
  release: { action: "drop"|"defer"|"delegate"; note: string } | null;
  schedule_status: "SCHEDULED"|"PENDING"|"NOT_APPLICABLE";
  pending_reason: "no_fit"|"deadline"|"depends_unmet"|null;
  suggested_need: { need: string; status: "unconfirmed"|"confirmed" } | null }
interface TrialResult { api_version: "1"; request_id: string; revision: number;
  source: "live"|"fallback"|"replay"; status: "ok"|"conflict"; judge_summary: string;
  decisions: Decision[]; schedule: { task_id: string; start: string; end: string }[];
  metrics: { original_min: number; approved_min: number; minutes_recovered: number; pending_min: number; free_capacity_min: number };
  conflicts: { code: string; task_ids: string[]; message: string }[]; appeals_used: number;
  change: { task_id: string; previous_verdict: Verdict; new_verdict: Verdict; previous_minutes_recovered: number;
    delta_minutes_recovered: number; new_fact: string | null } | null;
  meta?: { model: string; llm_calls: number; latency_ms: number } }
type QuestionType = "purpose"|"why_so_long"|"why_today"|"who_needs"|"minimal"|"free";
interface Proposal { title: string; duration_min: number; need: string; saved_min: number; cut_scope: string[];
  first_move: string; action_plan: PlanStep[]; done_when: string }
interface InterrogationResult { api_version: "1"; request_id: string; base_revision: number; source: string;
  status: "ok"; task_id: string; question_type: QuestionType; answer: string;
  rating: "supported"|"evasive"|"contradiction"; credibility_delta: number; proposal: Proposal | null }

DEMO CASE (for "Load demo case" and the mocks). Day 09:00–18:00, fixed block Lunch 13:00–14:00,
priorities Health > Learning > Work > Leisure.
- "Study maths" 120 min, minimum 120, MANDATORY, learning, fact "Maths exam on Monday" → APPROVED 120, 09:00–11:00.
- "Go to the gym" 60, minimum 30, health → APPROVED 60, 11:00–12:00.
- "Answer emails" 60, minimum 15, work, fact "Only five emails need a reply today"
  → REDUCED 15 "Reply to the five urgent emails", 12:00–12:15, SAVED 45.
  Not today: "Replying to the non-urgent emails (snooze them to Monday)", "Chasing inbox zero".
  First move: "Search your inbox and star the five emails that need a reply today."
  Plan: Star the five urgent emails 3 · Reply to each one in about two minutes 10 · Snooze everything else to Monday 2.
  Done when: "Five replies sent. Nothing else."
- "Prepare presentation" 120, minimum 90, work, facts "Presenting on Monday", "Only the core slides are essential;
  animations are optional" → REDUCED 90 "Build the essential slides", 14:00–15:30, SAVED 30.
  Not today: "Animations and transitions", "Visual polish beyond the core slides".
  First move: "Write your three key messages on a sticky note."
  Plan: Outline the three key messages 15 · Build the essential slides 60 · One run-through, out loud 15.
  Done when: "Core slides built and rehearsed once, out loud."
- Maths plan: Redo last week's problem sheet 60 · Review the two weakest topics 45 · Write a one-page summary of
  your mistakes 15; first move "Open last week's problem sheet and do question 1."
- Gym plan: Training session 45 · Stretching 15; first move "Put your trainers by the door."
(The full mock data lives in fixtures/run.response.json, fixtures/interrogate.response.json and fixtures/appeal.response.json; mirror them exactly.)
- "Check Instagram" 45, minimum 15, leisure, fact "I usually scroll when I am tired" → DISMISSED 0,
  suggested need "rest" (unconfirmed).
Metrics: original 405, approved 285, recovered 120, free capacity 195.
Personas: 📐 The Exam Hawk, 🏋️ Coach Thunder, 📧 The Inbox Martyr, 📊 The Perfectionist, 📱 Defender of Leisure.
Email lines: defense "I need a full hour. Every single email deserves a reply!" / prosecution
"Only five need a reply today. That is fifteen minutes, not sixty."
Judge: "Two approved, two reduced, one dismissed. The court returns 120 minutes to the defendant."
Mock cross-examination of Instagram, "What are you for?": "Honestly? You only scroll when you're tired. I'm not a hobby,
I'm a break in disguise. Give me fifteen minutes, screens off." Rating Supported, +0.2. Plea: "Screen-free break",
15 min, need rest, steps "Put the phone in another room", "Walk or stretch for 15 minutes".
Mock after accepting the plea (new fact "I haven't taken a break in six hours"): Instagram → REDUCED 15
"Screen-free break" 12:00–12:15, emails move to 12:15–12:30, approved 300, recovered 105, free capacity 180,
judge "Appeal granted. Rest is a legitimate need. Fifteen minutes, screens off. The court still returns 105 minutes."

Do NOT build: login, database, calendar sync, drag-and-drop on the timeline, settings pages, multiple rounds.
```

---

## Follow-ups (only if needed)
- "Make the minutes-recovered counter much bigger and animate it on every change."
- "Make the cross-examine sheet slide in from the right on desktop and from the bottom on mobile."
- "Add a subtle 'Objection!' stamp animation on the prosecution bubbles."

## After v0
Export the code into `frontend/` (download the ZIP or use the v0 CLI command it shows), then tell Claude. Claude will run `npm install` and replace the inline mocks with `fixtures/*.json`. Claude does not touch `.env` files: Carlos creates `.env.local` himself (`NEXT_PUBLIC_USE_MOCK=true`, `NEXT_PUBLIC_API_URL=http://localhost:8000`).
