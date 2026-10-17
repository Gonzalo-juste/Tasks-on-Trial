// "One question from the bench": at most one optional, one-tap question before the trial.
// Deterministic templates per archetype; an answer patches the task and becomes a confirmed fact.
// An unanswered question means "unknown", never "no".
import type { Archetype, CapturedTask } from "./estimates"
import type { Task } from "./types"

type PatchFn = (task: Task) => Partial<Task>

export interface WitnessOption {
  label: string
  fact: string
  patch: PatchFn
}

export interface WitnessQuestion {
  task_id: string
  archetype: Archetype
  question: string
  options: WitnessOption[]
}

const roundTo5 = (minutes: number) => Math.max(5, Math.round(minutes / 5) * 5)
const fullTime: PatchFn = (task) => ({ minimum_min: task.duration_min, allow_reduction: false })

const TEMPLATES: Partial<Record<Archetype, (task: Task) => Omit<WitnessQuestion, "task_id" | "archetype">>> = {
  book: (task) => ({
    question: `Would ${Math.min(45, task.duration_min)} focused minutes count as enough studying today?`,
    options: [
      {
        label: `Yes, ${Math.min(45, task.duration_min)}m`,
        fact: `${Math.min(45, task.duration_min)} focused minutes of study would be enough today`,
        patch: (t) => ({ minimum_min: Math.min(45, t.duration_min), allow_reduction: true }),
      },
      { label: `No, need ${task.duration_min}m`, fact: `Studying needs the full ${task.duration_min} minutes today`, patch: fullTime },
    ],
  }),
  slides: () => ({
    question: "Would a rough draft be enough today?",
    options: [
      { label: "Yes, a draft", fact: "A rough draft is enough today", patch: (t) => ({ minimum_min: Math.min(t.duration_min, roundTo5(t.duration_min / 2)), allow_reduction: true }) },
      { label: "Must be finished", fact: "It must be finished today", patch: fullTime },
    ],
  }),
  envelope: () => ({
    question: "How many emails actually need a reply today?",
    options: [
      { label: "None", fact: "No emails need a reply today", patch: () => ({ minimum_min: 5, allow_reduction: true }) },
      { label: "1–5", fact: "Between one and five emails need a reply today", patch: (t) => ({ minimum_min: Math.min(10, t.duration_min), allow_reduction: true }) },
      { label: "6+", fact: "Six or more emails need a reply today", patch: (t) => ({ minimum_min: Math.min(20, t.duration_min), allow_reduction: true }) },
      { label: "All", fact: "Every email needs a reply today", patch: fullTime },
    ],
  }),
  dumbbell: () => ({
    question: "Is travel included in your estimate?",
    options: [
      { label: "Yes", fact: "Travel is included in my estimate", patch: () => ({ buffer_min: 0 }) },
      { label: "Add 20m", fact: "The gym needs about 20 minutes of travel", patch: () => ({ buffer_min: 20 }) },
    ],
  }),
  broom: () => mustToday,
  cart: () => mustToday,
  heart: () => ({
    question: "Is this a commitment you promised for today?",
    options: [
      { label: "Yes, I promised", fact: "I promised this for today", patch: (t) => ({ mandatory: true, ...fullTime(t) }) },
      { label: "No", fact: "It is not a promise for today", patch: () => ({ mandatory: false }) },
    ],
  }),
  phone: () => ({
    question: "Do you want to protect this downtime?",
    options: [
      { label: "Protect it", fact: "I want to protect this downtime", patch: fullTime },
      { label: "Optional", fact: "This downtime is optional", patch: () => ({ allow_reduction: true }) },
    ],
  }),
  briefcase: () => canShorten,
  note: () => canShorten,
}

const mustToday = {
  question: "Must this happen today?",
  options: [
    { label: "Yes, today", fact: "It must happen today", patch: (t: Task) => ({ mandatory: true, ...fullTime(t) }) },
    { label: "Can wait", fact: "It can wait until another day", patch: () => ({ mandatory: false, allow_reduction: true }) },
  ],
}

const canShorten = {
  question: "Can this be shortened?",
  options: [
    { label: "Yes", fact: "This can be shortened", patch: () => ({ allow_reduction: true }) },
    { label: "No", fact: "This cannot be shortened", patch: fullTime },
  ],
}

// Which uncertainty changes a ruling most, first. Already-resolved tasks are skipped.
const PRIORITY: Archetype[] = ["book", "slides", "envelope", "dumbbell", "broom", "cart", "heart", "phone", "briefcase", "note"]

function isResolved(captured: CapturedTask) {
  const { task, archetype, estimated } = captured
  if (task.mandatory) return true
  if (archetype === "dumbbell") return !estimated.includes("buffer_min")
  return false
}

/** The single most decisive question for this docket, or null when there is nothing worth asking. */
export function pickWitnessQuestion(docket: CapturedTask[]): WitnessQuestion | null {
  for (const archetype of PRIORITY) {
    const captured = docket.find((c) => c.archetype === archetype && !isResolved(c))
    const template = captured && TEMPLATES[archetype]
    if (captured && template) return { task_id: captured.task.id, archetype, ...template(captured.task) }
  }
  return null
}

/** Applies a tapped answer: patches the task and records the answer as confirmed evidence. */
export function applyWitnessAnswer(task: Task, option: WitnessOption): Task {
  const patched = { ...task, ...option.patch(task) }
  patched.minimum_min = Math.min(patched.minimum_min, patched.duration_min)
  return { ...patched, facts: [...task.facts.filter((fact) => fact !== option.fact), option.fact] }
}
