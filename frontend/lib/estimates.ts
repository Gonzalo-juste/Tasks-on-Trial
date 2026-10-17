// Instant, local first guess for the Docket's quick capture. It fills every chip in milliseconds;
// /api/trial/init then refines the values. Shared defaults keep frontend and backend estimates consistent.
import type { Category, Task } from "./types"

export type Archetype = "dumbbell" | "envelope" | "book" | "slides" | "phone" | "broom" | "cart" | "briefcase" | "heart" | "note"

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
  phone: { emoji: "📱", category: "leisure", duration_min: 30, minimum_min: 10, buffer_min: 0, keywords: /\b(instagram|tiktok|twitter|x\.com|youtube|scroll|scrolling|social media|reddit|netflix)\b/i },
  broom: { emoji: "🧹", category: "other", duration_min: 30, minimum_min: 15, buffer_min: 0, keywords: /\b(clean|cleaning|laundry|dishes|tidy|hoover|vacuum|chores?)\b/i },
  cart: { emoji: "🛒", category: "other", duration_min: 45, minimum_min: 30, buffer_min: 15, keywords: /\b(shop|shopping|groceries|supermarket|buy|errands?|pharmacy)\b/i },
  briefcase: { emoji: "💼", category: "work", duration_min: 60, minimum_min: 30, buffer_min: 0, keywords: /\b(meeting|report|client|work|project|invoice|call with|proposal|code|coding)\b/i },
  heart: { emoji: "❤️", category: "family", duration_min: 60, minimum_min: 30, buffer_min: 10, keywords: /\b(mum|mom|dad|family|friend|friends|partner|date|kids?|visit|call (my|grandma|grandpa))\b/i },
  note: { emoji: "🗒️", category: "other", duration_min: 30, minimum_min: 15, buffer_min: 0, keywords: /$^/ },
}

const ORDER: Archetype[] = ["phone", "envelope", "slides", "book", "dumbbell", "cart", "broom", "heart", "briefcase"]

export function detectArchetype(text: string): Archetype {
  return ORDER.find((name) => ARCHETYPES[name].keywords.test(text)) ?? "note"
}

const DAY_WORDS = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)\b/i
const MANDATORY_WORDS = /\b(exam|deadline|due|must|mandatory|urgent|submit|submission|interview|appointment)\b/i
const DEADLINE_TIME = /\b(?:by|before|until)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
const EXPLICIT_DURATION = /\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i

export interface CapturedTask {
  task: Task & { buffer_min: number }
  archetype: Archetype
  emoji: string
  /** Fields that were guessed, so the UI can mark them "est." until the user or /init confirms them. */
  estimated: (keyof Task | "buffer_min")[]
}

const STOP_WORDS = /^(a|an|the|my|to|for|of|on|in|at|by|before|until|and|with|some|do|get|go|s|min|mins|minutes?|h|hrs?|hours?|am|pm|today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|week|\d+)$/

/** Short, readable id from the first two meaningful words, e.g. "study-maths". */
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
  if (match[3]?.toLowerCase() === "pm" && hours < 12) hours += 12
  if (match[3]?.toLowerCase() === "am" && hours === 12) hours = 0
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
  const estimated: CapturedTask["estimated"] = ["category", "minimum_min", "buffer_min", "allow_reduction"]

  const explicit = parseDuration(text)
  const ratio = ratios[archetype] ?? 1
  const duration = explicit ?? Math.max(5, Math.round((defaults.duration_min * ratio) / 5) * 5)
  if (explicit === null) estimated.push("duration_min")

  const mandatory = MANDATORY_WORDS.test(text)
  const deadline = parseDeadline(text)
  const minimum = mandatory ? duration : Math.min(duration, defaults.minimum_min)
  // The user's own words are the only evidence: keep the line as a fact when it says more than a title.
  const facts = DAY_WORDS.test(text) || MANDATORY_WORDS.test(text) || deadline || text.split(/\s+/).length > 3 ? [capitalise(text)] : []

  return {
    archetype,
    emoji: defaults.emoji,
    estimated,
    task: {
      id: slugify(text, taken),
      title: capitalise(text.replace(EXPLICIT_DURATION, "").replace(/\s{2,}/g, " ").trim()),
      duration_min: duration,
      minimum_min: minimum,
      buffer_min: defaults.buffer_min,
      mandatory,
      deadline,
      depends_on: [],
      category: defaults.category,
      allow_reduction: !mandatory,
      facts,
    },
  }
}

/** Quick capture: one task per line, at most six. */
export function quickCapture(rawText: string, ratios: Partial<Record<Archetype, number>> = {}): CapturedTask[] {
  const taken = new Set<string>()
  return rawText
    .split(/\r?\n|;/)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => captureLine(line, taken, ratios))
}
