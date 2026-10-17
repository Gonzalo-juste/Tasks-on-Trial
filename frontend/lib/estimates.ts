// Instant, local first guess for the Docket's quick capture. It fills every chip in milliseconds;
// /api/trial/init may refine the values. Shared defaults keep frontend and backend estimates consistent.
//
// Evidence rule: `facts` only ever holds what the user actually wrote or tapped. Archetype defaults
// (durations, buffers, minimums) are estimates and are listed in `estimated`, never in `facts`.
import type { Category, Task } from "./types"

export type Archetype = "dumbbell" | "envelope" | "book" | "slides" | "phone" | "broom" | "cart" | "briefcase" | "heart" | "note" | "runner"

interface ArchetypeDefaults {
  emoji: string
  category: Category
  duration_min: number
  minimum_min: number
  buffer_min: number
  keywords: RegExp
}

// Realistic defaults per archetype. Gonzalo's /init prompt uses the same table.
export const ARCHETYPES: Record<Archetype, ArchetypeDefaults> = {
  dumbbell: { emoji: "🏋️", category: "health", duration_min: 60, minimum_min: 30, buffer_min: 20, keywords: /\b(gym|workout|run|running|swim|yoga|train|training|exercise|football|cycle|cycling)\b/i },
  envelope: { emoji: "✉️", category: "work", duration_min: 30, minimum_min: 10, buffer_min: 0, keywords: /\b(e-?mails?|inbox|mail|reply|replies|messages?)\b/i },
  book: { emoji: "📚", category: "learning", duration_min: 90, minimum_min: 45, buffer_min: 0, keywords: /\b(study|studying|revise|revision|exam|read|reading|homework|course|lecture|learn)\b/i },
  slides: { emoji: "📊", category: "work", duration_min: 90, minimum_min: 60, buffer_min: 0, keywords: /\b(slides?|presentation|deck|pitch|keynote|powerpoint)\b/i },
  phone: { emoji: "📱", category: "leisure", duration_min: 30, minimum_min: 10, buffer_min: 0, keywords: /\b(instagram|tiktok|twitter|youtube|scroll|scrolling|social|reddit|netflix)\b/i },
  broom: { emoji: "🧹", category: "other", duration_min: 30, minimum_min: 15, buffer_min: 0, keywords: /\b(clean|cleaning|laundry|dishes|tidy|hoover|vacuum|chores?)\b/i },
  cart: { emoji: "🛒", category: "other", duration_min: 45, minimum_min: 30, buffer_min: 15, keywords: /\b(shop|shopping|groceries|supermarket|buy|errands?|pharmacy)\b/i },
  briefcase: { emoji: "💼", category: "work", duration_min: 60, minimum_min: 30, buffer_min: 0, keywords: /\b(meeting|report|client|work|project|invoice|call with|proposal|code|coding)\b/i },
  heart: { emoji: "❤️", category: "family", duration_min: 60, minimum_min: 30, buffer_min: 10, keywords: /\b(mum|mom|dad|family|friend|friends|partner|date|kids?|visit|call (my|grandma|grandpa))\b/i },
  note: { emoji: "🗒️", category: "other", duration_min: 30, minimum_min: 15, buffer_min: 0, keywords: /$^/ },
  runner: { emoji: "🏃", category: "health", duration_min: 30, minimum_min: 15, buffer_min: 0, keywords: /\b(run|running|jog|jogging|5k|10k)\b/i },
}

// "slides" before "book" so "Finish pitch slides" is not read as study; "phone" first so "scroll" wins.
const ORDER: Archetype[] = ["phone", "envelope", "slides", "book", "runner", "dumbbell", "cart", "broom", "heart", "briefcase"]

export function detectArchetype(text: string): Archetype {
  return ORDER.find((name) => ARCHETYPES[name].keywords.test(text)) ?? "note"
}

/** One-tap additions for the Docket. Each one appends a line to the quick-capture text. */
export const QUICK_ADD: { label: string; line: string }[] = [
  { label: "Study", line: "Study" },
  { label: "Gym", line: "Gym" },
  { label: "Emails", line: "Reply to emails" },
  { label: "Slides", line: "Finish slides" },
  { label: "Chores", line: "Chores" },
  { label: "Social", line: "Scroll social media" },
]

/** Rough sizes for editing an estimated duration. Explicit user durations are never replaced. */
export const SIZES = { XS: 15, S: 30, M: 60, L: 120 } as const

/** "Try a chaotic day": real parser input, not a hard-coded verdict. 365 minutes requested. */
export const CHAOTIC_DAY = [
  "Finish pitch slides 90 min due 6pm",
  "Study for exam 90 min",
  "Gym 60 min + 20 min travel",
  "Go for a run 30 min",
  "Reply to emails 30 min",
  "Scroll TikTok 45 min",
].join("\n")

export const MAX_TASKS = 6

// Only explicit words make a task non-negotiable. "Exam tomorrow" is context, not an obligation to study today.
const MANDATORY_WORDS = /\b(must|have to|has to|mandatory|non-negotiable|required|promised)\b/i
const CONTEXT_WORDS = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|exam|deadline|interview|appointment)\b/i
const DEADLINE_TIME = /\b(?:by|before|until|due(?:\s+(?:at|by))?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
const BUFFER = /\+\s*(\d+)\s*(?:m|min|mins|minutes?)\b(?:\s+(?:of\s+)?(?:travel|commute|setup|getting there))?/i
const EXPLICIT_DURATION = /\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i

export type EstimatedField = "duration_min" | "minimum_min" | "buffer_min" | "category" | "allow_reduction"

export interface CapturedTask {
  task: Task & { buffer_min: number }
  archetype: Archetype
  emoji: string
  /** Fields that were guessed, so the UI can mark them "est." until the user or /init confirms them. */
  estimated: EstimatedField[]
}

const STOP_WORDS = /^(a|an|the|my|to|for|of|on|in|at|by|before|until|due|and|with|some|do|get|go|s|min|mins|minutes?|h|hrs?|hours?|am|pm|travel|today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|week|\d+)$/

/** Short, readable id from the first two meaningful words, e.g. "study-exam". */
function slugify(text: string, taken: Set<string>) {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word && !STOP_WORDS.test(word))
  const base = words.slice(0, 2).join("-") || "task"
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

function parseDeadline(line: string): string | null {
  const match = line.match(DEADLINE_TIME)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2] ?? 0)
  const meridiem = match[3]?.toLowerCase()
  if (meridiem === "pm" && hours < 12) hours += 12
  if (meridiem === "am" && hours === 12) hours = 0
  // "due 6" without am/pm during a working day almost always means the afternoon.
  if (!meridiem && hours >= 1 && hours <= 7) hours += 12
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function parseDuration(line: string): number | null {
  const match = line.match(EXPLICIT_DURATION)
  if (!match) return null
  const value = Number(match[1])
  return Math.round(/^h/i.test(match[2]) ? value * 60 : value)
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Turns one free-text line into a fully filled task.
 * `ratios` comes from calibration (actual / planned per archetype) and scales the default duration.
 */
export function captureLine(line: string, taken: Set<string>, ratios: Partial<Record<Archetype, number>> = {}): CapturedTask {
  const text = line.trim()
  const archetype = detectArchetype(text)
  const defaults = ARCHETYPES[archetype]
  const estimated: EstimatedField[] = ["category"]

  const bufferMatch = text.match(BUFFER)
  const withoutBuffer = bufferMatch ? text.replace(bufferMatch[0], " ") : text
  const deadlineMatch = withoutBuffer.match(DEADLINE_TIME)
  const deadline = parseDeadline(withoutBuffer)

  const explicit = parseDuration(withoutBuffer)
  const ratio = ratios[archetype] ?? 1
  const duration = explicit ?? Math.max(5, Math.round((defaults.duration_min * ratio) / 5) * 5)
  if (explicit === null) estimated.push("duration_min")

  // Outdoor activity starts at the door: only gym-style sessions get a default travel buffer.
  const startsAtTheDoor = archetype === "dumbbell" && /\b(run|running|jog|jogging|walk|cycle|cycling)\b/i.test(text)
  const buffer = bufferMatch ? Number(bufferMatch[1]) : startsAtTheDoor ? 0 : defaults.buffer_min
  if (!bufferMatch) estimated.push("buffer_min")

  const mandatory = MANDATORY_WORDS.test(text)
  const minimum = mandatory ? duration : Math.min(duration, defaults.minimum_min)
  if (!mandatory) estimated.push("minimum_min", "allow_reduction")

  // Facts are the user's own words only.
  const facts: string[] = []
  if (deadline) facts.push(`Due at ${deadline}`)
  if (bufferMatch) facts.push(`Needs ${buffer} minutes of travel or setup`)
  if (CONTEXT_WORDS.test(text) || mandatory) facts.push(capitalise(text))

  const title = capitalise(
    withoutBuffer
      .replace(deadlineMatch?.[0] ?? "", " ")
      .replace(EXPLICIT_DURATION, " ")
      .replace(/[—–-]\s*$/, " ")
      .replace(/\s{2,}/g, " ")
      .trim(),
  )

  return {
    archetype,
    emoji: defaults.emoji,
    estimated,
    task: {
      id: slugify(text, taken),
      title,
      duration_min: duration,
      minimum_min: minimum,
      buffer_min: buffer,
      mandatory,
      deadline,
      depends_on: [],
      category: defaults.category,
      allow_reduction: !mandatory,
      facts,
    },
  }
}

export interface QuickCaptureResult {
  tasks: Task[]
  /** Guessed fields per task id, so the UI can mark them "est.". */
  estimated: Record<string, EstimatedField[]>
  /** Lines beyond the sixth: they wait outside the docket, never silently dropped. */
  waiting: string[]
  captured: CapturedTask[]
}

/** Quick capture: one task per line. The first six enter the docket. */
export function quickCapture(rawText: string, ratios: Partial<Record<Archetype, number>> = {}): QuickCaptureResult {
  const taken = new Set<string>()
  const lines = rawText
    .split(/\r?\n|;/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
  const captured = lines.slice(0, MAX_TASKS).map((line) => captureLine(line, taken, ratios))
  return {
    tasks: captured.map((c) => c.task),
    estimated: Object.fromEntries(captured.map((c) => [c.task.id, c.estimated])),
    waiting: lines.slice(MAX_TASKS),
    captured,
  }
}
