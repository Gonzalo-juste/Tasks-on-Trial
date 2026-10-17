export type Category = "health" | "learning" | "work" | "money" | "family" | "leisure" | "other"

export type Archetype = "dumbbell" | "envelope" | "book" | "slides" | "phone" | "broom" | "cart" | "briefcase" | "heart" | "note" | "runner"

export interface Task {
  id: string
  title: string
  duration_min: number
  buffer_min: number
  minimum_min: number
  mandatory: boolean
  deadline: string | null
  depends_on: string[]
  category: Category
  allow_reduction: boolean
  facts: string[]
}

export interface Constitution {
  timezone: string
  start: string
  end: string
  fixed_blocks: { start: string; end: string; label: string }[]
  priorities: Category[]
}

export interface Rules {
  mode: "immediate" | "quick" | "standard" | "grand"
  /** Debate rounds per defendant: quick 1, standard 2, grand 3. */
  rounds?: number
  severity: number
  drama: number
}

export interface Case {
  tasks: Task[]
  constitution: Constitution
  rules: Rules
  /** Minutes the user grants the court today (after fixed commitments). Tasks compete for it. */
  budget_min?: number
}

export type Verdict = "APPROVED" | "REDUCED" | "DISMISSED"

export interface PlanStep {
  step: string
  minutes: number
  detail?: string
  tip?: string
}

export interface Decision {
  task_id: string
  persona: { emoji: string; name: string; archetype: Archetype }
  defense: string
  prosecution: string
  /** Full debate, rounds x (defence, prosecution). Optional: without it the trial shows one round. */
  exchanges?: { round: number; speaker: "defense" | "prosecution"; text: string }[]
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
  /** Set on a task folded into another through a pact. */
  merged_into?: string
}

export interface TrialResult {
  api_version: "1"
  request_id: string
  revision: number
  source: "live" | "fallback" | "replay"
  status: "ok" | "conflict"
  judge_summary: string
  decisions: Decision[]
  /** rest_after_min: a pre-assigned break after the task, part of the slot (sent by the backend when supported). */
  schedule: { task_id: string; start: string; end: string; buffer_min: number; rest_after_min?: number }[]
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
  /** Pact replacements can drop the travel buffer (0 is significant). */
  buffer_min?: number
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

export interface Relation {
  a: string
  b: string
  type: "ally" | "rival" | "depends"
  reason: string
}

export interface WitnessQuestion {
  id: string
  task_id: string
  question: string
  options: { label: string; fact: string; patch: Partial<Task> | null }[]
}

export interface InitResult {
  request_id: string
  api_version: "1"
  source: string
  status: "ok"
  case: Case
  estimated: Record<string, string[]>
  questions: WitnessQuestion[]
  relations: Relation[]
}

export interface ReviseResult {
  request_id: string
  api_version: "1"
  source: string
  status: "ok"
  task_id: string
  first_move: string
  done_when: string
  action_plan: PlanStep[]
}
