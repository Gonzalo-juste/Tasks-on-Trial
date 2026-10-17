export type Category = "health" | "learning" | "work" | "money" | "family" | "leisure" | "other"

export interface Task {
  id: string
  title: string
  duration_min: number
  minimum_min: number
  mandatory: boolean
  deadline: string | null
  depends_on: string[]
  category: Category
  allow_reduction: boolean
  facts: string[]
  /** Travel/setup overhead before the task. Counts toward the budget, never toward the plan steps. */
  buffer_min?: number
}

export interface Constitution {
  timezone: string
  start: string
  end: string
  fixed_blocks: { start: string; end: string; label: string }[]
  priorities: Category[]
}

export interface Case {
  tasks: Task[]
  constitution: Constitution
  /** Minutes the user grants the court today (after fixed commitments). Tasks compete for it. */
  budget_min?: number
}

export type Verdict = "APPROVED" | "REDUCED" | "DISMISSED"

export interface PlanStep {
  step: string
  minutes: number
}

export interface Decision {
  task_id: string
  persona: { emoji: string; name: string }
  defense: string
  prosecution: string
  verdict: Verdict
  original_min: number
  approved_min: number
  /** original_min - approved_min, plus buffer_min when the task is DISMISSED. */
  saved_min: number
  buffer_min?: number
  effective_title: string
  reason: string
  cut_scope: string[]
  first_move: string | null
  action_plan: PlanStep[]
  done_when: string | null
  release: { action: "drop" | "defer" | "delegate"; note: string } | null
  schedule_status: "SCHEDULED" | "PENDING" | "NOT_APPLICABLE"
  pending_reason: "no_fit" | "deadline" | "depends_unmet" | null
  suggested_need: { need: string; status: "unconfirmed" | "confirmed" } | null
}

export interface TrialResult {
  api_version: "1"
  request_id: string
  revision: number
  source: "live" | "fallback" | "replay"
  status: "ok" | "conflict"
  judge_summary: string
  decisions: Decision[]
  schedule: { task_id: string; start: string; end: string; buffer_min?: number }[]
  metrics: {
    original_min: number
    approved_min: number
    minutes_recovered: number
    pending_min: number
    free_capacity_min: number
    budget_min?: number
    unallocated_min?: number
  }
  conflicts: { code: string; task_ids: string[]; message: string }[]
  appeals_used: number
  change: {
    task_id: string
    previous_verdict: Verdict
    new_verdict: Verdict
    previous_minutes_recovered: number
    delta_minutes_recovered: number
    new_fact: string | null
  } | null
  meta?: { model: string; llm_calls: number; latency_ms: number }
}

export type QuestionType = "purpose" | "why_so_long" | "why_today" | "who_needs" | "minimal" | "free"

export interface Proposal {
  title: string
  duration_min: number
  saved_min: number
  need: string
  cut_scope: string[]
  first_move: string
  action_plan: PlanStep[]
  done_when: string
}

export interface InterrogationResult {
  api_version: "1"
  request_id: string
  base_revision: number
  source: string
  status: "ok"
  task_id: string
  question_type: QuestionType
  answer: string
  rating: "supported" | "evasive" | "contradiction"
  credibility_delta: number
  proposal: Proposal | null
}
