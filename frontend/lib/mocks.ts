import type { Case, Category, Decision, InterrogationResult, PlanStep, QuestionType, TrialResult } from "@/lib/types"

export const demoCase: Case = {
  constitution: {
    timezone: "Europe/London",
    start: "09:00",
    end: "18:00",
    fixed_blocks: [{ start: "13:00", end: "14:00", label: "Lunch" }],
      priorities: ["health", "learning", "work", "leisure"],
    },
  rules: { mode: "quick", severity: 0.5, drama: 0.5 },
  tasks: [
    { id: "maths", title: "Study maths", duration_min: 120, buffer_min: 0, minimum_min: 120, mandatory: true, deadline: null, depends_on: [], category: "learning", allow_reduction: false, facts: ["Maths exam on Monday"] },
    { id: "gym", title: "Go to the gym", duration_min: 60, buffer_min: 0, minimum_min: 30, mandatory: false, deadline: null, depends_on: [], category: "health", allow_reduction: true, facts: [] },
    { id: "emails", title: "Answer emails", duration_min: 30, buffer_min: 0, minimum_min: 10, mandatory: false, deadline: null, depends_on: [], category: "work", allow_reduction: true, facts: ["Only five emails need a reply today"] },
    { id: "presentation", title: "Prepare presentation", duration_min: 120, buffer_min: 0, minimum_min: 90, mandatory: false, deadline: null, depends_on: [], category: "work", allow_reduction: true, facts: ["Presenting on Monday", "Only the core slides are essential; animations are optional"] },
    { id: "instagram", title: "Check Instagram", duration_min: 45, buffer_min: 0, minimum_min: 15, mandatory: false, deadline: null, depends_on: [], category: "leisure", allow_reduction: true, facts: ["I usually scroll when I am tired"] },
  ],
}

const personaById: Record<string, { emoji: string; name: string; archetype: import("@/lib/types").Archetype }> = {
  maths: { emoji: "📐", name: "The Exam Hawk", archetype: "book" },
  gym: { emoji: "🏋️", name: "Coach Thunder", archetype: "dumbbell" },
  emails: { emoji: "📧", name: "The Inbox Martyr", archetype: "envelope" },
  presentation: { emoji: "📊", name: "The Perfectionist", archetype: "slides" },
  instagram: { emoji: "📱", name: "Defender of Leisure", archetype: "phone" },
}

function makeDecision(taskId: string, title: string, original: number, approved: number, verdict: Decision["verdict"], effectiveTitle: string, defense: string, prosecution: string, reason: string, firstMove: string | null, actionPlan: PlanStep[], doneWhen: string | null, scheduleStatus: Decision["schedule_status"], extras: Partial<Pick<Decision, "cut_scope" | "release" | "suggested_need">> = {}): Decision {
  return {
    task_id: taskId,
    persona: personaById[taskId] ?? { emoji: "⚖️", name: "The Applicant", archetype: "note" },
    defense,
    prosecution,
    verdict,
    original_min: original,
    approved_min: approved,
    saved_min: original - approved,
    effective_title: effectiveTitle || title,
    reason,
    cut_scope: extras.cut_scope ?? [],
    first_move: firstMove,
    action_plan: actionPlan,
    done_when: doneWhen,
    release: extras.release ?? null,
    schedule_status: scheduleStatus,
    pending_reason: null,
    suggested_need: extras.suggested_need ?? null,
  }
}

const initialDecisions: Decision[] = [
  makeDecision("maths", "Study maths", 120, 120, "APPROVED", "Study maths", "My exam is Monday. Two focused hours today will keep me on track.", "The defendant has supplied evidence of a real deadline.", "A near-term exam makes this a proportionate commitment.", "Open last week’s problem sheet and do question 1.", [{ step: "Redo last week’s problem sheet", minutes: 60 }, { step: "Review the two weakest topics", minutes: 45 }, { step: "Write a one-page summary of your mistakes", minutes: 15 }], "Problem sheet finished and mistakes summarised on one page.", "SCHEDULED"),
  makeDecision("gym", "Go to the gym", 60, 60, "APPROVED", "Go to the gym", "Movement keeps my mind sharp. I can be there and back in an hour.", "A useful habit, though the court will not award bonus minutes for optimism.", "A healthy commitment with a clear, bounded scope.", "Put your trainers by the door.", [{ step: "Training session", minutes: 45 }, { step: "Stretching", minutes: 15 }], "45 minutes of training and 15 of stretching done.", "SCHEDULED"),
  makeDecision("emails", "Answer emails", 30, 15, "REDUCED", "Reply to the urgent emails", "I need a full hour. Every single email deserves a reply!", "Only five need a reply today. That is fifteen minutes, not sixty.", "The confirmed workload supports a brief triage, not an open-ended inbox session.", "Search your inbox and star the five emails that need a reply today.", [{ step: "Star the five urgent emails", minutes: 3 }, { step: "Reply to each one in about two minutes", minutes: 10 }, { step: "Snooze everything else to Monday", minutes: 2 }], "Five replies sent. Nothing else.", "SCHEDULED", { cut_scope: ["Replying to the non-urgent emails (snooze them to Monday)", "Chasing inbox zero"] }),
  makeDecision("presentation", "Prepare presentation", 120, 90, "REDUCED", "Build the essential slides", "A polished deck needs time. I cannot send something unfinished.", "The core slides are essential; animations are optional.", "The deadline is real, but optional polish is not part of the case.", "Write your three key messages on a sticky note.", [{ step: "Outline the three key messages", minutes: 15 }, { step: "Build the essential slides", minutes: 60 }, { step: "One run-through, out loud", minutes: 15 }], "Core slides built and rehearsed once, out loud.", "SCHEDULED", { cut_scope: ["Animations and transitions", "Visual polish beyond the core slides"] }),
  makeDecision("instagram", "Check Instagram", 45, 0, "DISMISSED", "Check Instagram", "I deserve a little scroll. It helps me switch off.", "The evidence says tiredness, not Instagram, is the actual need.", "A feed is not a restorative break. The need for rest is noted, not yet scheduled.", null, [], null, "NOT_APPLICABLE", { cut_scope: ["45 minutes of scrolling"], release: { action: "drop", note: "Not today. If you are tired, cross-examine it: the real need may be rest." }, suggested_need: { need: "rest", status: "unconfirmed" } }),
]

export const demoTrialResult: TrialResult = {
  api_version: "1",
  request_id: "replay-demo-001",
  revision: 1,
  source: "replay",
  status: "ok",
  judge_summary: "Two approved, two reduced, one dismissed. The court returns 90 minutes to the day.",
  decisions: initialDecisions,
  schedule: [
    { task_id: "maths", start: "09:00", end: "11:00", buffer_min: 0 },
    { task_id: "gym", start: "11:00", end: "12:20", buffer_min: 20 },
    { task_id: "emails", start: "12:20", end: "12:35", buffer_min: 0 },
    { task_id: "presentation", start: "14:00", end: "15:30", buffer_min: 0 },
  ],
  metrics: { original_min: 375, approved_min: 285, minutes_recovered: 90, pending_min: 0, free_capacity_min: 175 },
  conflicts: [],
  appeals_used: 0,
  change: null,
  meta: { model: "replay", llm_calls: 0, latency_ms: 0 },
}

export const demoInterrogation: InterrogationResult = {
  api_version: "1",
  request_id: "replay-interrogation-001",
  base_revision: 1,
  source: "replay",
  status: "ok",
  task_id: "instagram",
  question_type: "purpose",
  answer: "Honestly? You only scroll when you are tired. I am not a hobby, I am a break in disguise. Give me fifteen minutes, screens off.",
  rating: "supported",
  credibility_delta: 0.2,
  proposal: { title: "Screen-free break", duration_min: 15, saved_min: 30, need: "rest", cut_scope: ["Scrolling"], first_move: "Put your phone in another room. Now.", action_plan: [{ step: "Put the phone in another room", minutes: 2 }, { step: "Walk or stretch, no screens", minutes: 13 }], done_when: "Fifteen minutes away from every screen." },
}

const answers: Record<QuestionType, Pick<InterrogationResult, "answer" | "rating" | "credibility_delta">> = {
  purpose: { answer: "I promise a little relief, but the facts suggest what you need is a genuine pause, not another feed.", rating: "supported", credibility_delta: 0.2 },
  why_so_long: { answer: "There is no real reason for forty-five minutes. A short, deliberate break would do the job.", rating: "supported", credibility_delta: 0.15 },
  why_today: { answer: "Nothing is happening today that makes this urgent. I can wait until the work is done.", rating: "evasive", credibility_delta: -0.05 },
  who_needs: { answer: "You do, when you are tired. But the scrolling is only a substitute for rest.", rating: "supported", credibility_delta: 0.1 },
  minimal: { answer: "Fifteen minutes, with the phone out of reach, is enough to reset.", rating: "supported", credibility_delta: 0.2 },
  free: { answer: "The record does not support a longer session. Try a screen-free pause and see how you feel.", rating: "evasive", credibility_delta: 0 },
}

export function mockInterrogation(taskId: string, questionType: QuestionType, baseRevision: number): InterrogationResult {
  const answer = taskId === "instagram" && questionType === "purpose" ? demoInterrogation : answers[questionType]
  return {
    api_version: "1", request_id: `replay-interrogation-${Date.now()}`, base_revision: baseRevision, source: "replay", status: "ok",
    task_id: taskId, question_type: questionType, ...answer,
    proposal: taskId === "instagram" ? demoInterrogation.proposal : null,
  }
}

export function mockAppeal(previous: TrialResult, taskId: string, newFact: string | null): TrialResult {
  const decision = previous.decisions.find((item) => item.task_id === taskId)
  if (!decision) return previous
  const beforeVerdict = decision.verdict
  const oldRecovered = previous.metrics.minutes_recovered
  const updatedDecision: Decision = {
    ...decision,
    verdict: "REDUCED",
    approved_min: 15,
    saved_min: 30,
    effective_title: "Screen-free break",
    reason: "Rest is a legitimate need. A short, screen-free pause meets it without extending the scroll.",
    cut_scope: ["Scrolling"],
    first_move: "Put your phone in another room. Now.",
    action_plan: [{ step: "Put the phone in another room", minutes: 2 }, { step: "Walk or stretch, no screens", minutes: 13 }],
    done_when: "Fifteen minutes away from every screen.",
    release: null,
    schedule_status: "SCHEDULED",
    suggested_need: { need: "rest", status: "confirmed" },
  }
  const decisions = previous.decisions.map((item) => item.task_id === taskId ? updatedDecision : item)
  const schedule = previous.schedule.filter((item) => item.task_id !== taskId)
  if (taskId === "instagram") {
    schedule.push({ task_id: "instagram", start: "12:20", end: "12:35", buffer_min: 0 })
    const emails = schedule.find((item) => item.task_id === "emails")
    if (emails) { emails.start = "12:35"; emails.end = "12:50" }
  }
  return {
    ...previous,
    request_id: `replay-appeal-${Date.now()}`,
    revision: previous.revision + 1,
    source: "replay",
    judge_summary: "Appeal granted. Rest is a legitimate need. Fifteen minutes, screens off. The court still returns 105 minutes.",
    decisions,
    schedule: schedule.sort((a, b) => a.start.localeCompare(b.start)),
    metrics: { ...previous.metrics, approved_min: 300, minutes_recovered: 75, free_capacity_min: 160 },
    appeals_used: 1,
    change: { task_id: taskId, previous_verdict: beforeVerdict, new_verdict: "REDUCED", previous_minutes_recovered: oldRecovered, delta_minutes_recovered: -15, new_fact: newFact },
  }
}

export function categoryLabel(category: Category) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}
