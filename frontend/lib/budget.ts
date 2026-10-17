// Client-side time budget. The backend stays the source of truth: this module gives instant
// feedback in the Docket, clock times for plan steps, sanity checks on API responses and a
// rule-based fallback when the court is unreachable. Times are "HH:MM" in the day's timezone.
import type { Case, Category, Constitution, Decision, PlanStep, Task, TrialResult } from "./types"

type BudgetTask = Task & { buffer_min?: number }
type Slot = { task_id: string; start: string; end: string; buffer_min: number }

export const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number)
  return hours * 60 + minutes
}

export const toClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

const bufferOf = (task: BudgetTask) => Math.max(0, task.buffer_min ?? 0)

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

export function dayCapacity(constitution: Constitution) {
  const dayStart = toMinutes(constitution.start)
  const dayEnd = toMinutes(constitution.end)
  const blocked = mergeIntervals(
    constitution.fixed_blocks.map((block) => [
      Math.max(dayStart, toMinutes(block.start)),
      Math.min(dayEnd, toMinutes(block.end)),
    ]),
  )
  const free: [number, number][] = []
  let cursor = dayStart
  for (const [start, end] of blocked) {
    if (start > cursor) free.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (cursor < dayEnd) free.push([cursor, dayEnd])
  const fixedMin = blocked.reduce((sum, [a, b]) => sum + (b - a), 0)
  return { window_min: dayEnd - dayStart, fixed_min: fixedMin, usable_min: dayEnd - dayStart - fixedMin, free }
}

export type BudgetStatus = "fits" | "tight" | "overbooked"

/** Budget presets for the Docket, in minutes. 4h is the suggested default. */
export const BUDGET_PRESETS = [120, 240, 360, 480] as const
export const DEFAULT_BUDGET_MIN = 240
export const BUDGET_STEP_MIN = 30

/**
 * What the tasks ask for versus the minutes the user granted the court. Drives the Docket's meter.
 * The granted budget is discretionary time after fixed commitments, so fixed blocks only limit it
 * when the calendar window is smaller: effective = min(granted, free calendar capacity).
 */
export function budgetFor(caseData: Case) {
  const { usable_min } = dayCapacity(caseData.constitution)
  const granted_min = caseData.budget_min ?? usable_min
  const effective_min = Math.min(granted_min, usable_min)
  const tasks = caseData.tasks as BudgetTask[]
  const work_min = tasks.reduce((sum, task) => sum + task.duration_min, 0)
  const buffer_min = tasks.reduce((sum, task) => sum + bufferOf(task), 0)
  const requested_min = work_min + buffer_min
  const mandatory_min = tasks.filter((t) => t.mandatory).reduce((sum, t) => sum + t.duration_min + bufferOf(t), 0)
  const over_by_min = Math.max(0, requested_min - effective_min)
  const ratio = effective_min > 0 ? requested_min / effective_min : Infinity
  const status: BudgetStatus = ratio > 1 ? "overbooked" : ratio > 0.85 ? "tight" : "fits"
  return {
    granted_min, usable_min, effective_min, work_min, buffer_min, requested_min, mandatory_min, over_by_min, ratio, status,
    /** Mandatory tasks alone exceed the budget: no verdict can fix that. */
    impossible: mandatory_min > effective_min,
    capped_by_calendar: effective_min < granted_min,
  }
}

const hours = (minutes: number) => (minutes % 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`)

/** Shape the Docket's meter consumes. */
export interface BudgetSummary {
  grantedMinutes: number
  requestedMinutes: number
  mandatoryMinutes: number
  overBudgetMinutes: number
  bufferMinutes: number
  defendants: number
  impossible: boolean
}

/** The Docket's meter: what the tasks (work + buffers) demand versus the minutes granted. */
export function budget(tasks: Task[], grantedMinutes: number): BudgetSummary {
  const granted = Math.max(0, Math.round(grantedMinutes))
  const cost = (task: BudgetTask) => Math.max(0, task.duration_min) + bufferOf(task)
  const requestedMinutes = tasks.reduce((sum, task) => sum + cost(task), 0)
  const mandatoryMinutes = tasks.filter((task) => task.mandatory).reduce((sum, task) => sum + cost(task), 0)
  return {
    grantedMinutes: granted,
    requestedMinutes,
    mandatoryMinutes,
    overBudgetMinutes: Math.max(0, requestedMinutes - granted),
    bufferMinutes: tasks.reduce((sum, task) => sum + bufferOf(task), 0),
    defendants: tasks.length,
    impossible: mandatoryMinutes > granted,
  }
}

/** Copy for the Docket's meter. */
export function budgetHeadline(summary: BudgetSummary) {
  const title = `You have granted the court ${hours(summary.grantedMinutes)}. Your tasks demand ${summary.requestedMinutes} minutes.`
  const line = summary.impossible
    ? "Impossible as filed: your mandatory tasks alone exceed the budget. Grant more time or review what is mandatory."
    : summary.overBudgetMinutes > 0
      ? `${summary.overBudgetMinutes} minutes over budget. Someone must make a case.`
      : `${summary.grantedMinutes - summary.requestedMinutes} minutes to spare. The court may still cut.`
  return { title, line, defendants: `${summary.defendants} ${summary.defendants === 1 ? "defendant" : "defendants"} summoned` }
}

/** Clock times for each step: the slot starts with its buffer, then steps run back to back. */
export function stepTimes(slot: Slot, plan: PlanStep[]) {
  let cursor = toMinutes(slot.start) + Math.max(0, slot.buffer_min ?? 0)
  return plan.map((step) => {
    const start = cursor
    cursor += step.minutes
    return { ...step, start: toClock(start), end: toClock(cursor) }
  })
}

/** Checks the invariants the backend promises. Returns human-readable issues (empty means OK). */
export function checkInvariants(result: TrialResult): string[] {
  const issues: string[] = []
  const savedTotal = result.decisions.reduce((sum, d) => sum + d.saved_min, 0)
  if (savedTotal !== result.metrics.minutes_recovered) {
    issues.push(`Sum of saved_min (${savedTotal}) differs from minutes_recovered (${result.metrics.minutes_recovered}).`)
  }
  for (const d of result.decisions) {
    const expectedSaved = d.original_min - d.approved_min + (d.verdict === "DISMISSED" ? d.buffer_min ?? 0 : 0)
    if (d.saved_min !== expectedSaved) issues.push(`${d.task_id}: saved_min ${d.saved_min}, expected ${expectedSaved}.`)
    if (d.verdict !== "DISMISSED") {
      const planMin = d.action_plan.reduce((sum, step) => sum + step.minutes, 0)
      if (planMin !== d.approved_min) issues.push(`${d.task_id}: plan sums to ${planMin}, approved is ${d.approved_min}.`)
    }
    const scheduled = result.schedule.some((slot) => slot.task_id === d.task_id)
    if (d.schedule_status === "SCHEDULED" && !scheduled) issues.push(`${d.task_id}: SCHEDULED but missing from schedule.`)
    if (d.verdict === "DISMISSED" && scheduled) issues.push(`${d.task_id}: DISMISSED but scheduled.`)
  }
  const slots = [...result.schedule].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  for (let i = 1; i < slots.length; i++) {
    if (toMinutes(slots[i].start) < toMinutes(slots[i - 1].end)) {
      issues.push(`Overlap between ${slots[i - 1].task_id} and ${slots[i].task_id}.`)
    }
  }
  return issues
}

/** Same ordering the backend uses: mandatory, nearest deadline, declared priority, then id. */
function placementOrder(tasks: BudgetTask[], priorities: Category[]) {
  const rank = (task: BudgetTask) => {
    const index = priorities.indexOf(task.category)
    return index === -1 ? priorities.length : index
  }
  const sorted = [...tasks].sort(
    (a, b) =>
      Number(b.mandatory) - Number(a.mandatory) ||
      (a.deadline ? toMinutes(a.deadline) : Infinity) - (b.deadline ? toMinutes(b.deadline) : Infinity) ||
      rank(a) - rank(b) ||
      a.id.localeCompare(b.id),
  )
  // Requirements first: stable topological pass over the sorted list.
  const placed: BudgetTask[] = []
  const pending = new Set(sorted.map((task) => task.id))
  while (pending.size) {
    const next = sorted.find(
      (task) => pending.has(task.id) && task.depends_on.every((dep) => !pending.has(dep) || !sorted.some((t) => t.id === dep)),
    )
    if (!next) break // cycle: leave the rest to the backend's validation
    placed.push(next)
    pending.delete(next.id)
  }
  return placed
}

/**
 * Greedy placement of approved minutes into the free intervals, within the granted budget
 * (work + buffers). Tasks are indivisible.
 */
export function planDay(caseData: Case, approved: Record<string, number>) {
  const free = dayCapacity(caseData.constitution).free.map(([a, b]) => [a, b] as [number, number])
  const tasks = placementOrder(caseData.tasks as BudgetTask[], caseData.constitution.priorities)
  let remainingBudget = budgetFor(caseData).effective_min
  const ends: Record<string, number> = {}
  const schedule: Slot[] = []
  const pending: { task_id: string; reason: "no_fit" | "deadline" | "depends_unmet" }[] = []
  for (const task of tasks) {
    const minutes = approved[task.id] ?? 0
    if (minutes <= 0) continue
    if (task.depends_on.some((dep) => (approved[dep] ?? 0) > 0 && ends[dep] === undefined)) {
      pending.push({ task_id: task.id, reason: "depends_unmet" })
      continue
    }
    const earliest = Math.max(0, ...task.depends_on.map((dep) => ends[dep] ?? 0))
    const need = minutes + bufferOf(task)
    if (need > remainingBudget) {
      pending.push({ task_id: task.id, reason: "no_fit" })
      continue
    }
    const deadline = task.deadline ? toMinutes(task.deadline) : Infinity
    const index = free.findIndex(([a, b]) => Math.max(a, earliest) + need <= b)
    if (index === -1) {
      pending.push({ task_id: task.id, reason: "no_fit" })
      continue
    }
    const start = Math.max(free[index][0], earliest)
    if (start + need > deadline) {
      pending.push({ task_id: task.id, reason: "deadline" })
      continue
    }
    const [a, b] = free[index]
    free.splice(index, 1, ...([[a, start], [start + need, b]] as [number, number][]).filter(([x, y]) => y > x))
    ends[task.id] = start + need
    remainingBudget -= need
    schedule.push({ task_id: task.id, start: toClock(start), end: toClock(start + need), buffer_min: bufferOf(task) })
  }
  schedule.sort((x, y) => toMinutes(x.start) - toMinutes(y.start))
  return { schedule, pending }
}

/** Rule-based result when the court is unreachable: everything approved at its confirmed duration. */
export function fallbackResult(caseData: Case): TrialResult {
  const approved = Object.fromEntries(caseData.tasks.map((task) => [task.id, task.duration_min]))
  const { schedule, pending } = planDay(caseData, approved)
  const pendingById = new Map(pending.map((p) => [p.task_id, p.reason]))
  const decisions: Decision[] = caseData.tasks.map((task) => ({
    task_id: task.id,
    persona: { emoji: "🗒️", name: task.title, archetype: "note" },
    defense: "The court is offline. I stand on my confirmed duration.",
    prosecution: "No objection recorded: rule-based fallback.",
    verdict: "APPROVED",
    original_min: task.duration_min,
    approved_min: task.duration_min,
    saved_min: 0,
    buffer_min: bufferOf(task as BudgetTask),
    effective_title: task.title,
    reason: "Rule-based fallback: confirmed duration kept.",
    cut_scope: [],
    first_move: `Start on ${task.title.toLowerCase()}.`,
    action_plan: [{ step: `Work on ${task.title.toLowerCase()}`, minutes: task.duration_min }],
    done_when: `${task.title} done.`,
    release: null,
    schedule_status: pendingById.has(task.id) ? "PENDING" : "SCHEDULED",
    pending_reason: pendingById.get(task.id) ?? null,
    suggested_need: null,
  }))
  // Metrics count buffers: they are part of what each task costs the user.
  const approvedMin = decisions.reduce((sum, d) => sum + d.approved_min + (d.buffer_min ?? 0), 0)
  const pendingMin = decisions
    .filter((d) => d.schedule_status === "PENDING")
    .reduce((sum, d) => sum + d.approved_min + (d.buffer_min ?? 0), 0)
  const scheduledLoad = schedule.reduce((sum, slot) => sum + toMinutes(slot.end) - toMinutes(slot.start), 0)
  const b = budgetFor(caseData)
  return {
    api_version: "1",
    request_id: `fallback-${Date.now()}`,
    revision: 1,
    source: "fallback",
    status: "ok",
    judge_summary: "The court is offline. Rule-based fallback: nothing cut, tasks placed by priority until the budget runs out.",
    decisions,
    schedule,
    metrics: {
      original_min: approvedMin,
      approved_min: approvedMin,
      minutes_recovered: 0,
      pending_min: pendingMin,
      free_capacity_min: dayCapacity(caseData.constitution).usable_min - scheduledLoad,
      budget_min: b.effective_min,
      unallocated_min: b.effective_min - scheduledLoad,
    },
    conflicts: [],
    appeals_used: 0,
    change: null,
  }
}
