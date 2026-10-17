import { API_VERSION, caseFromApi, caseToApi, constitutionToApi, post, requestId, resultFromApi, resultToApi } from "@/lib/api"
import { demoTrialResult } from "@/lib/mocks"
import type { Archetype, Case, Category, Constitution, InitResult, ReviseResult, Task, TrialResult, WitnessQuestion } from "@/lib/types"

const MOCK_DELAY_MS = 1500

export interface PardonInput {
  case: Case
  task_id: string
  previous_result: TrialResult
  base_revision: number
  pardon: true
}

export interface ReviseInput {
  case: Case
  task_id: string
  instruction: string
  previous_result: TrialResult
  base_revision: number
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS))
}

const archetypeFor = (line: string): Archetype => {
  const text = line.toLowerCase()
  if (/\b(run|running|jog|jogging)\b/.test(text)) return "runner"
  if (/gym|workout|exercise|train/.test(text)) return "dumbbell"
  if (/email|inbox|reply/.test(text)) return "envelope"
  if (/math|study|read|exam|book/.test(text)) return "book"
  if (/presentation|slides|deck/.test(text)) return "slides"
  if (/instagram|phone|social|scroll/.test(text)) return "phone"
  if (/clean|sweep|chores/.test(text)) return "broom"
  if (/shop|cart|groceries/.test(text)) return "cart"
  if (/meeting|brief|report|work/.test(text)) return "briefcase"
  if (/family|care|call mum|call mom/.test(text)) return "heart"
  return "note"
}

const categoryFor = (archetype: Archetype): Category => ({
  dumbbell: "health", envelope: "work", book: "learning", slides: "work", phone: "leisure",
  broom: "other", cart: "money", briefcase: "work", heart: "family", note: "other", runner: "health",
} satisfies Record<Archetype, Category>)[archetype]

function makeMockTask(line: string, index: number): Task {
  const normalized = line.trim()
  const archetype = archetypeFor(normalized)
  const category = categoryFor(archetype)
  const presets: Record<string, Partial<Task>> = {
    maths: { id: "maths", title: "Study maths", duration_min: 120, minimum_min: 120, mandatory: true, category: "learning", allow_reduction: false, facts: ["Maths exam on Monday"] },
    gym: { id: "gym", title: "Gym", duration_min: 60, minimum_min: 30, category: "health", buffer_min: 0 },
    emails: { id: "emails", title: "Answer emails", duration_min: 30, minimum_min: 10, category: "work", facts: [] },
    presentation: { id: "presentation", title: "Prepare Monday presentation", duration_min: 120, minimum_min: 90, category: "work", facts: ["Presenting on Monday"] },
    instagram: { id: "instagram", title: "Instagram", duration_min: 45, minimum_min: 15, category: "leisure", facts: ["I usually scroll when I am tired"] },
  }
  const presetKey = /math|study/.test(normalized.toLowerCase()) ? "maths"
    : /gym|workout/.test(normalized.toLowerCase()) ? "gym"
      : /email|inbox/.test(normalized.toLowerCase()) ? "emails"
        : /presentation|slides/.test(normalized.toLowerCase()) ? "presentation"
          : /instagram|scroll/.test(normalized.toLowerCase()) ? "instagram" : ""
  const fallbackTitle = normalized.replace(/^./, (letter) => letter.toUpperCase())
  const duration = archetype === "dumbbell" ? 60 : archetype === "book" || archetype === "slides" ? 90 : 30
  return {
    id: `task-${index + 1}`,
    title: fallbackTitle,
    duration_min: duration,
    buffer_min: 0,
    minimum_min: Math.min(duration, 15),
    mandatory: false,
    deadline: null,
    depends_on: [],
    category,
    allow_reduction: true,
    facts: [],
    ...(presetKey ? presets[presetKey] : {}),
  }
}

function mockQuestions(): WitnessQuestion[] {
  return [
    {
      id: "emails-replies",
      task_id: "emails",
      question: "How many emails actually need a reply today?",
      options: [
        { label: "None", fact: "No emails need a reply today", patch: { duration_min: 10, minimum_min: 0 } },
        { label: "1–5", fact: "Only 1–5 emails need a reply today", patch: { duration_min: 30, minimum_min: 10 } },
        { label: "6–15", fact: "6–15 emails need a reply today", patch: { duration_min: 45, minimum_min: 20 } },
        { label: "All of them", fact: "Every email needs a reply today", patch: null },
      ],
    },
    {
      id: "gym-travel",
      task_id: "gym",
      question: "Does the gym include getting there and back?",
      options: [
        { label: "Yes, about 20 min", fact: "Gym travel takes about 20 minutes", patch: { buffer_min: 20 } },
        { label: "I train at home", fact: "Training happens at home; no travel buffer is needed", patch: { buffer_min: 0 } },
      ],
    },
  ]
}

export async function init(raw_text: string, constitution: Constitution): Promise<InitResult> {
  if (process.env.NEXT_PUBLIC_USE_MOCK === "true") {
    await pause()
    const lines = raw_text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 10)
    const tasks = lines.map(makeMockTask)
    const known = new Set(tasks.map((task) => task.id))
    return {
      request_id: `mock-init-${Date.now()}`,
      api_version: "1",
      source: "fallback",
      status: "ok",
      case: { tasks, constitution, rules: { mode: "quick", severity: 0.5, drama: 0.5 } },
      estimated: Object.fromEntries(tasks.map((task) => [task.id, ["duration_min", "minimum_min", "buffer_min", "category"]])),
      questions: mockQuestions().filter((question) => known.has(question.task_id)),
      relations: [
        ...(known.has("maths") && known.has("instagram") ? [{ a: "maths", b: "instagram", type: "rival" as const, reason: "Study time competes with scrolling." }] : []),
        ...(known.has("presentation") && known.has("emails") ? [{ a: "presentation", b: "emails", type: "ally" as const, reason: "Both are work matters." }] : []),
      ],
    }
  }
  const result = await post<InitResult>("/api/trial/init", {
    request_id: requestId("init"), api_version: API_VERSION, raw_text, constitution: constitutionToApi(constitution),
  })
  return { ...result, case: caseFromApi({ ...result.case, rules: result.case.rules ?? { mode: "quick", severity: 0.5, drama: 0.5 } }) }
}

export async function pardon(input: PardonInput): Promise<TrialResult> {
  if (process.env.NEXT_PUBLIC_USE_MOCK === "true") {
    await pause()
    const current = input.previous_result
    const target = current.decisions.find((decision) => decision.task_id === input.task_id)
    if (!target) return current
    const decisions = current.decisions.map((decision) => decision.task_id === input.task_id ? {
      ...decision,
      verdict: "APPROVED" as const,
      approved_min: decision.original_min,
      saved_min: 0,
      effective_title: decision.effective_title,
      reason: "The judge grants a pardon. The task may return to the day.",
      release: null,
      schedule_status: "SCHEDULED" as const,
    } : decision)
    const schedule = [...current.schedule]
    if (!schedule.some((slot) => slot.task_id === input.task_id)) schedule.push({ task_id: input.task_id, start: "15:30", end: "16:15", buffer_min: 0 })
    return {
      ...current,
      request_id: `mock-pardon-${Date.now()}`,
      revision: current.revision + 1,
      decisions,
      schedule: schedule.sort((a, b) => a.start.localeCompare(b.start)),
      metrics: { ...current.metrics, approved_min: current.metrics.approved_min + target.original_min, minutes_recovered: Math.max(0, current.metrics.minutes_recovered - target.original_min), free_capacity_min: Math.max(0, current.metrics.free_capacity_min - target.original_min) },
    }
  }
  const result = await post<TrialResult>("/api/trial/appeal", {
    request_id: requestId("pardon"), api_version: API_VERSION, ...input, pardon: true,
    new_fact: null, accepted_replacement: null,
    case: caseToApi(input.case), previous_result: resultToApi(input.previous_result),
  })
  return resultFromApi(result)
}

export async function revise(input: ReviseInput): Promise<ReviseResult> {
  if (process.env.NEXT_PUBLIC_USE_MOCK === "true") {
    await pause()
    const isEmails = input.task_id === "emails"
    return {
      request_id: `mock-revise-${Date.now()}`,
      api_version: "1",
      source: "fallback",
      status: "ok",
      task_id: input.task_id,
      first_move: isEmails ? "Open your inbox and search 'is:unread newer_than:2d'" : `Open the materials for ${input.task_id} and begin the first small step.`,
      done_when: isEmails ? "Every starred email answered. Inbox untouched otherwise." : "The agreed scope is complete and ready to stop.",
      action_plan: isEmails ? [
        { step: "Triage", minutes: 3, detail: "Star only emails that block someone today", tip: "If it can wait until Monday, it waits" },
        { step: "Reply to the urgent ones", minutes: 10, detail: "Two minutes each, three sentences max", tip: "Use a template opener" },
        { step: "Snooze the rest", minutes: 2 },
      ] : [
        { step: "Set up the materials", minutes: 3, detail: "Open only what you need for this task.", tip: "Put your phone out of reach." },
        { step: "Do the first focused block", minutes: 20, detail: "Work only on the smallest useful outcome." },
        { step: "Check the result and stop", minutes: 5, tip: "Stopping on time is part of the plan." },
      ],
    }
  }
  return post<ReviseResult>("/api/trial/revise", {
    request_id: requestId("revise"), api_version: API_VERSION, ...input,
    case: caseToApi(input.case), previous_result: resultToApi(input.previous_result),
  })
}

export const mockTrialFixture = demoTrialResult
