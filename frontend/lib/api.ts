import { demoTrialResult, mockAppeal, mockInterrogation } from "@/lib/mocks"
import type { Case, Constitution, InterrogationResult, Proposal, QuestionType, TrialResult } from "@/lib/types"

const MOCK_DELAY_MS = 1500
const API_VERSION = "1"

export interface InterrogateInput {
  case: Case
  task_id: string
  question_type: QuestionType
  question_text: string | null
  previous_result: TrialResult
  base_revision: number
}

export interface AppealInput {
  case: Case
  task_id: string
  new_fact: string | null
  accepted_replacement: Proposal | null
  previous_result: TrialResult
  base_revision: number
}

export const requestId = (prefix: string) => `${prefix}-${Date.now()}`
export { API_VERSION }

// The UI works with "HH:MM"; the API contract uses RFC 3339 in Europe/London.
const TIMEZONE = "Europe/London"
const isClock = (value: string) => /^\d{2}:\d{2}$/.test(value)

function londonDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date())
}

function londonOffset() {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, timeZoneName: "shortOffset" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!match) return "+00:00"
  return `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}`
}

const toIso = (value: string) => (isClock(value) ? `${londonDate()}T${value}:00${londonOffset()}` : value)
const toClock = (value: string) => (isClock(value) ? value : value.slice(11, 16))

export function constitutionToApi(constitution: Constitution): Constitution {
  return {
    ...constitution,
    timezone: TIMEZONE,
    start: toIso(constitution.start),
    end: toIso(constitution.end),
    fixed_blocks: constitution.fixed_blocks.map((block) => ({ ...block, start: toIso(block.start), end: toIso(block.end) })),
  }
}

const clockMinutes = (time: string) => {
  const [h, m] = toClock(time).split(":").map(Number)
  return h * 60 + m
}

/** The Docket sets the window to start + granted budget + commitments; recover the budget from it when absent. */
function grantedBudget(caseData: Case) {
  if (caseData.budget_min !== undefined) return caseData.budget_min
  const { start, end, fixed_blocks } = caseData.constitution
  const fixed = fixed_blocks.reduce((sum, block) => sum + Math.max(0, clockMinutes(block.end) - clockMinutes(block.start)), 0)
  return Math.max(0, clockMinutes(end) - clockMinutes(start) - fixed)
}

// The backend rejects budget_min until it supports it; the Docket's window already encodes the budget.
const SEND_BUDGET = process.env.NEXT_PUBLIC_SEND_BUDGET === "true"
const SEND_ROUNDS = process.env.NEXT_PUBLIC_SEND_ROUNDS === "true"

export function caseToApi(caseData: Case): Case {
  const { budget_min: _omit, ...rest } = caseData
  // The backend knows "quick" | "immediate"; standard and grand only change the frontend's pacing,
  // and a grand trial asks for more drama.
  const { rounds: _rounds, ...baseRules } = rest.rules ?? ({} as Case["rules"])
  const rounds = rest.rules?.mode === "grand" ? 3 : rest.rules?.mode === "standard" ? 2 : 1
  const rules = rest.rules && {
    ...baseRules,
    mode: rest.rules.mode === "immediate" ? "immediate" : "quick",
    drama: rest.rules.mode === "grand" ? Math.max(rest.rules.drama, 0.85) : rest.rules.drama,
    // Sent only once the backend accepts it (NEXT_PUBLIC_SEND_ROUNDS=true).
    ...(SEND_ROUNDS ? { rounds } : {}),
  }
  return {
    ...rest,
    ...(rules ? { rules: rules as Case["rules"] } : {}),
    ...(SEND_BUDGET ? { budget_min: grantedBudget(caseData) } : {}),
    tasks: caseData.tasks.map((task) => ({ ...task, deadline: task.deadline ? toIso(task.deadline) : null })),
    constitution: constitutionToApi(caseData.constitution),
  }
}

/** Back to the UI's "HH:MM"; a missing buffer_min means zero. */
export function caseFromApi(caseData: Case): Case {
  const { constitution } = caseData
  return {
    ...caseData,
    tasks: caseData.tasks.map((task) => ({ ...task, buffer_min: task.buffer_min ?? 0, deadline: task.deadline ? toClock(task.deadline) : null })),
    constitution: {
      ...constitution,
      start: toClock(constitution.start),
      end: toClock(constitution.end),
      fixed_blocks: constitution.fixed_blocks.map((block) => ({ ...block, start: toClock(block.start), end: toClock(block.end) })),
    },
  }
}

export const resultToApi = (result: TrialResult): TrialResult => ({
  ...result,
  schedule: result.schedule.map((slot) => ({ ...slot, start: toIso(slot.start), end: toIso(slot.end) })),
})

export const resultFromApi = (result: TrialResult): TrialResult => ({
  ...result,
  schedule: result.schedule.map((slot) => ({ ...slot, buffer_min: slot.buffer_min ?? 0, start: toClock(slot.start), end: toClock(slot.end) })),
})

function pause() {
  return new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS))
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL
  if (!baseUrl) throw new Error("The live court is not connected yet. You can retry, or use the included replay case.")
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  return response.json() as Promise<T>
}

/** Turns the backend's { error: { code, message } } into something the user can act on. */
async function errorMessage(response: Response) {
  let code = ""
  let message = ""
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } }
    code = body.error?.code ?? ""
    message = body.error?.message ?? ""
  } catch {
    // Not JSON (e.g. a proxy error page): fall through to the generic text.
  }
  if (code === "REVISION_CONFLICT") return "The court has restarted since this trial. Convene the court again, then try once more."
  if (message) return message
  return `The court could not complete the request (${response.status}). Please try again or use replay.`
}

export async function run(caseData: Case): Promise<TrialResult> {
  if (process.env.NEXT_PUBLIC_USE_MOCK === "true") {
    await pause()
    return { ...demoTrialResult, source: "fallback", request_id: `mock-run-${Date.now()}` }
  }
  const result = await post<TrialResult>("/api/trial/run", { request_id: requestId("run"), api_version: API_VERSION, confirmed: true, case: caseToApi(caseData) })
  return resultFromApi(result)
}

export async function interrogate(input: InterrogateInput): Promise<InterrogationResult> {
  if (process.env.NEXT_PUBLIC_USE_MOCK === "true") {
    await pause()
    return mockInterrogation(input.task_id, input.question_type, input.base_revision)
  }
  return post<InterrogationResult>("/api/trial/interrogate", {
    request_id: requestId("int"), api_version: API_VERSION, ...input,
    case: caseToApi(input.case), previous_result: resultToApi(input.previous_result),
  })
}

export async function appeal(input: AppealInput): Promise<TrialResult> {
  if (process.env.NEXT_PUBLIC_USE_MOCK === "true") {
    await pause()
    return mockAppeal(input.previous_result, input.task_id, input.new_fact)
  }
  const result = await post<TrialResult>("/api/trial/appeal", {
    request_id: requestId("appeal"), api_version: API_VERSION, ...input,
    case: caseToApi(input.case), previous_result: resultToApi(input.previous_result),
  })
  return resultFromApi(result)
}

export async function runReplay(): Promise<TrialResult> {
  await pause()
  return { ...demoTrialResult, source: "replay", request_id: `replay-run-${Date.now()}` }
}

export async function interrogateReplay(input: InterrogateInput): Promise<InterrogationResult> {
  await pause()
  return mockInterrogation(input.task_id, input.question_type, input.base_revision)
}

export async function appealReplay(input: AppealInput): Promise<TrialResult> {
  await pause()
  return mockAppeal(input.previous_result, input.task_id, input.new_fact)
}
