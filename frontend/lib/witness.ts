// "One question from the bench": at most one optional, one-tap question before the trial.
// Deterministic templates per archetype; an answer patches the task and becomes a confirmed fact.
// An unanswered question means "unknown", never "no".
import { detectArchetype, type Archetype } from "./estimates"
import type { Task, WitnessQuestion } from "./types"

type Option = WitnessQuestion["options"][number]
type Template = (task: Task) => { question: string; options: Option[] }

const roundTo5 = (minutes: number) => Math.max(5, Math.round(minutes / 5) * 5)
const fullTime = (task: Task): Partial<Task> => ({ minimum_min: task.duration_min, allow_reduction: false })

const mustToday: Template = (task) => ({
  question: "Must this happen today?",
  options: [
    { label: "Yes, today", fact: "It must happen today", patch: { mandatory: true, ...fullTime(task) } },
    { label: "Can wait", fact: "It can wait until another day", patch: { mandatory: false, allow_reduction: true } },
  ],
})

const canShorten: Template = (task) => ({
  question: "Can this be shortened?",
  options: [
    { label: "Yes", fact: "This can be shortened", patch: { allow_reduction: true } },
    { label: "No", fact: "This cannot be shortened", patch: fullTime(task) },
  ],
})

const TEMPLATES: Record<Archetype, Template> = {
  book: (task) => {
    const focus = Math.min(45, task.duration_min)
    return {
      question: `Would ${focus} focused minutes count as enough studying today?`,
      options: [
        { label: `Yes, ${focus}m`, fact: `${focus} focused minutes of study would be enough today`, patch: { minimum_min: focus, allow_reduction: true } },
        { label: `No, need ${task.duration_min}m`, fact: `Studying needs the full ${task.duration_min} minutes today`, patch: fullTime(task) },
      ],
    }
  },
  slides: (task) => ({
    question: "Would a rough draft be enough today?",
    options: [
      { label: "Yes, a draft", fact: "A rough draft is enough today", patch: { minimum_min: Math.min(task.duration_min, roundTo5(task.duration_min / 2)), allow_reduction: true } },
      { label: "Must be finished", fact: "It must be finished today", patch: fullTime(task) },
    ],
  }),
  envelope: (task) => ({
    question: "How many emails actually need a reply today?",
    options: [
      { label: "None", fact: "No emails need a reply today", patch: { minimum_min: Math.min(5, task.duration_min), allow_reduction: true } },
      { label: "1–5", fact: "Between one and five emails need a reply today", patch: { minimum_min: Math.min(10, task.duration_min), allow_reduction: true } },
      { label: "6+", fact: "Six or more emails need a reply today", patch: { minimum_min: Math.min(20, task.duration_min), allow_reduction: true } },
      { label: "All", fact: "Every email needs a reply today", patch: fullTime(task) },
    ],
  }),
  dumbbell: () => ({
    question: "Is travel included in your estimate?",
    options: [
      { label: "Yes", fact: "Travel is included in my estimate", patch: { buffer_min: 0 } },
      { label: "Add 20m", fact: "The gym needs about 20 minutes of travel", patch: { buffer_min: 20 } },
    ],
  }),
  broom: mustToday,
  cart: mustToday,
  heart: (task) => ({
    question: "Is this a commitment you promised for today?",
    options: [
      { label: "Yes, I promised", fact: "I promised this for today", patch: { mandatory: true, ...fullTime(task) } },
      { label: "No", fact: "It is not a promise for today", patch: { mandatory: false } },
    ],
  }),
  phone: (task) => ({
    question: "Do you want to protect this downtime?",
    options: [
      { label: "Protect it", fact: "I want to protect this downtime", patch: fullTime(task) },
      { label: "Optional", fact: "This downtime is optional", patch: { allow_reduction: true } },
    ],
  }),
  briefcase: canShorten,
  note: canShorten,
  runner: canShorten,
}

// Which uncertainty changes a ruling most, first.
const PRIORITY: Archetype[] = ["book", "slides", "envelope", "dumbbell", "broom", "cart", "heart", "phone", "briefcase", "runner", "note"]

/** Mandatory tasks, tasks with a typed deadline (already evidence), explicit travel buffers and answered tasks need no question. */
function isResolved(task: Task, archetype: Archetype) {
  if (task.mandatory || task.deadline) return true
  if (archetype === "dumbbell" && /travel|setup/i.test(task.facts.join(" "))) return true
  const askedFacts = TEMPLATES[archetype](task).options.map((option) => option.fact)
  return task.facts.some((fact) => askedFacts.includes(fact))
}

/** The single most decisive question for this docket, or null when there is nothing worth asking. */
export function pickWitnessQuestion(docket: Task[]): WitnessQuestion | null {
  const typed = docket.map((task) => ({ task, archetype: detectArchetype(task.title) }))
  for (const archetype of PRIORITY) {
    const match = typed.find((t) => t.archetype === archetype && !isResolved(t.task, archetype))
    if (match) return { id: `${archetype}-${match.task.id}`, task_id: match.task.id, ...TEMPLATES[archetype](match.task) }
  }
  return null
}

/** Applies a tapped answer: patches the task and records the answer as confirmed evidence. */
export function applyWitnessAnswer(task: Task, option: Option): Task {
  const patched = { ...task, ...(option.patch ?? {}) }
  patched.minimum_min = Math.min(patched.minimum_min, patched.duration_min)
  return { ...patched, facts: [...task.facts.filter((fact) => fact !== option.fact), option.fact] }
}
