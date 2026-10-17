# v0 prompt: Tasks on Trial

Paste the block below into v0 as the first prompt. Iterate with short follow-ups; don't regenerate the whole thing.

---

```
Build a single-page web app called "Tasks on Trial" with Next.js (App Router), TypeScript, Tailwind and shadcn/ui.

CONCEPT
Most planners ask how to fit everything in. This one flips it: the calendar starts EMPTY and every task
must earn its place in a British-style courtroom. Tasks pitch themselves, a judge rules, and the user
can cross-examine any task. Unproven tasks stay out and the user keeps the free time. The hero metric
is FREE TIME KEPT.

LAYOUT (one screen, desktop first, 3 columns, stacks on mobile)
Header: logo "Tasks on Trial", tagline "The calendar starts empty. Your tasks must earn their place.",
a large animated counter "Free time kept: 30 min" (with "15 min protected" underneath), and a small
provenance badge: "Live · Nebius" / "Rule fallback" / "Replay".

Left column, "The Docket" (setup):
- Day window: start and end time inputs. One "protected block" row (start/end, label "Breathing room").
  "Add fixed block" button for rows like meetings.
- Priorities: draggable-order chips (Health, Work, Money, Family, Learning). Up/down buttons are fine.
- Task list (max 6 rows). Each row: title, duration (min), optional deadline (time), category select,
  "evidence" short text field, optional "requires" multi-select of other tasks, and a 3-state toggle:
  Auto / Include / Exclude.
- Primary button: "Start the trial" (gavel icon). A "Load demo case" button fills the form with the demo data below.

Center column, "The Courtroom":
- Task cards in a row: emoji, title, duration, category, a credibility meter (0–100%), and a speech bubble
  with the task's latest line. A typewriter effect reveals text; a "Skip to verdict" button shows everything instantly.
- Judge's bench below the cards: judge avatar (emoji with a wig 👨‍⚖️), the verdict text, and per-task status
  badges: ADMITTED (green), NOT PROVEN (amber), DOES NOT FIT (grey), EXCLUDED (red outline).
- "Cross-examine" panel, opened by clicking a card:
  5 question buttons: "What are you for?", "Why so long?", "Why today?", "Who needs you?",
  "What's your smallest version?", plus a free-text question input. Max 3 questions per task (show a 3-dot counter).
  The answer appears as the task's bubble with a rating badge: ✅ Supported / ⚠️ Evasive / ❌ Contradiction.
  If the answer includes a proposal, show a "Plea deal" card: new title, new duration (e.g. 45 → 5 min),
  steps, and two buttons: "Accept plea" and "Reject". Accepting re-runs the verdict.

Right column, "Your Day":
- A vertical timeline for the day window (e.g. 15:00–16:00, 1 px per ~6 s is fine), showing:
  scheduled tasks (solid, colored by category, with time range and expandable steps), fixed blocks (striped),
  the protected block (soft green, label "Breathing room"), and FREE time (empty, dashed outline, labeled "Free").
- Below it, "Adjourned" (pending): each pending task with its reason ("Not proven", "Does not fit",
  "Deadline", "Waiting on another task") and a "next step" line.
- A conflicts banner (red) if the API returns conflicts.

STATES
idle, loading (lock all inputs, show a "The court is deliberating..." shimmer), success, error
(friendly message + "Retry" + "Use replay" button). Ignore any response whose revision is older than the latest request.

STYLE
"Go wild" but readable: a modern British courtroom. Deep navy and mahogany backgrounds, brass/gold accents,
cream paper cards, serif headings (e.g. Playfair Display) and a clean sans for body text. Subtle wood-grain
or paper texture, a gavel animation when the verdict lands, and the free-time counter animating up when a task loses.
Keep motion short and skippable.

DATA AND API
Put all state in React (no database, no auth). Create /lib/types.ts with these types and /lib/api.ts with
runTrial(req: TrialRequest): Promise<TrialResponse> that POSTs to `${process.env.NEXT_PUBLIC_API_URL}/api/trial/run`.
If NEXT_PUBLIC_USE_MOCK === "true", return the mock responses below after a 1.5 s delay instead.

type Action = "initial" | "interrogate" | "appeal";
type QuestionType = "purpose" | "why_so_long" | "why_today" | "who_needs" | "minimal" | "free";
interface Block { start: string; end: string; label?: string }
interface Task { id: string; title: string; duration_min: number; deadline_at: string | null;
  requires: string[]; category: "health"|"work"|"money"|"family"|"learning"|"other"; evidence: string }
interface TrialRequest { request_id: string; revision: number; action: Action;
  day: { date: string; timezone: string; start: string; end: string; fixed_blocks: Block[]; protected_blocks: Block[] };
  tasks: Task[]; priorities: string[]; forced_ids: string[]; excluded_ids: string[];
  history: Message[];
  interrogation: { task_id: string; question_type: QuestionType; question_text: string | null } | null;
  appeal: { task_id: string; proposed_title: string; proposed_duration_min: number; proposed_steps: string[]; user_confirmed: boolean } | null }
interface Message { task_id: string; kind: "pitch"|"answer"|"appeal"|"verdict"; text: string }
interface TrialResponse { request_id: string; revision: number; status: "ok";
  provenance: "live"|"rule_fallback"|"replay"; messages: Message[];
  interrogation_result: { task_id: string; question_type: QuestionType; answer: string;
    rating: "supported"|"evasive"|"contradiction"; credibility: number;
    proposal: { title: string; duration_min: number; steps: string[] } | null } | null;
  decision: { admitted: string[]; pending: { task_id: string; reason_code: "not_proven"|"no_fit"|"deadline"|"requires_unmet"; next_step: string }[]; reason: string };
  schedule: { task_id: string; start: string; end: string; steps: string[] }[];
  free_min: number; protected_min: number;
  conflicts: { code: string; task_ids: string[]; message: string }[];
  meta?: { model_judge: string; model_tasks: string; llm_calls: number; latency_ms: number } }

DEMO CASE (for "Load demo case" and mocks)
Window 15:00–16:00, protected 15:45–16:00 "Breathing room". Priorities: Health, Work.
Tasks: "Send the demo" (10 min, deadline 15:15, work, evidence "Submission form closes at 15:15. The build is ready."),
"Go for a walk" (20 min, health, "I have been sitting all morning."),
"Polish the slides" (45 min, work, "A basic deck already exists. The title slide has a typo.").
Mock initial verdict: Send 15:00–15:10, Walk 15:10–15:30, Slides adjourned ("Does not fit"), free 30 min (15 protected).
Mock "Why so long?" answer for Slides: "Why 45 minutes? ...Fine. The deck exists. Only the title slide has a typo.
Five minutes, honestly." Rating Supported, credibility 70%, plea deal "Fix the title slide typo", 5 min.
Mock after accepting the plea: Slides scheduled 15:30–15:35, free 25 min.
Mock "Why today?" for Walk: "No comment." Rating Evasive.

Do NOT build: login, database, calendar sync, drag-and-drop on the timeline, multiple rounds, settings pages.
```

---

## Follow-up prompts (use only if needed)
- "Make the free-time counter much bigger and animate it when a task is adjourned."
- "Add a gavel sound-free animation and a short screen shake when the verdict lands."
- "Make the cross-examine panel a right-side sheet on mobile."
