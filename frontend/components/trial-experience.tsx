"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, Gavel, Send, ShieldCheck, Sparkles, X } from "lucide-react"
import { JudgeCharacter, ProsecutorCharacter, TaskCharacter } from "@/components/task-character-art"
import DocketIntake from "@/components/docket-intake"
import { FocusRoom } from "@/components/focus-room"
import { appeal, interrogate, run, runReplay } from "@/lib/api"
import { pardon, revise, type PardonInput } from "@/lib/api-extra"
import { demoCase } from "@/lib/mocks"
import type { Archetype, Case, Decision, InitResult, InterrogationResult, Proposal, QuestionType, ReviseResult, Task, TrialResult, Verdict } from "@/lib/types"

const verdictTone: Record<Verdict, string> = { APPROVED: "approved", REDUCED: "reduced", DISMISSED: "dismissed" }
/** Display only: drop engine codes like "not_proven: " (the raw reason must go back to the backend unchanged). */
const cleanReason = (reason: string) => reason.replace(/^[a-z_]+:\s*/, "")
// Questions that make sense for where the task ended up: no "why so long?" to a task that got zero minutes.
const QUESTIONS_BY_VERDICT: Record<Verdict, { label: string; type: QuestionType; text?: string }[]> = {
  APPROVED: [
    { label: "Why do you deserve all of it?", type: "purpose" },
    { label: "Could you be done sooner?", type: "why_so_long" },
    { label: "What's your smallest version?", type: "minimal" },
  ],
  REDUCED: [
    { label: "Is the shorter version enough?", type: "free", text: "Is your reduced version really enough to do the job today? Be honest." },
    { label: "What did you have to cut?", type: "free", text: "What exactly did you lose in the reduction, and does it matter today?" },
    { label: "Why should you get more time?", type: "purpose" },
  ],
  DISMISSED: [
    { label: "What are you really for?", type: "purpose" },
    { label: "Why should you come back today?", type: "why_today" },
    { label: "What's the smallest version of you?", type: "minimal" },
  ],
}
/** Two compatible tasks join forces: a dismissed task folds into an ally that the court kept. */
interface Pact { allyId: string; allyTitle: string; targetId: string; mergeId: string; pitch: string; proposal: Proposal }

/**
 * Gym and run are compatible: whichever was dismissed can partner with the one the court kept.
 * The pact is always filed on the gym (its 60 minutes leave room for a strictly smaller combined session)
 * and the run is merged into it: running to the gym replaces the commute.
 */
function buildPact(dismissed: Decision, tasks: Task[], decisions: Decision[]): Pact | null {
  if (dismissed.verdict !== "DISMISSED") return null
  const kindOf = (id: string) => { const task = tasks.find((item) => item.id === id); return task ? archetypeForTask(task) : null }
  const dismissedKind = kindOf(dismissed.task_id)
  if (dismissedKind !== "dumbbell" && dismissedKind !== "runner") return null
  const partnerKind = dismissedKind === "dumbbell" ? "runner" : "dumbbell"
  const ally = decisions.find((decision) => decision.verdict !== "DISMISSED" && !decision.merged_into && kindOf(decision.task_id) === partnerKind)
  if (!ally) return null
  const gymTask = tasks.find((task) => task.id === (dismissedKind === "dumbbell" ? dismissed.task_id : ally.task_id))
  const runTask = tasks.find((task) => task.id === (dismissedKind === "runner" ? dismissed.task_id : ally.task_id))
  const allyTask = tasks.find((task) => task.id === ally.task_id)
  if (!gymTask || !runTask || !allyTask) return null
  const minutes = Math.max(10, gymTask.duration_min - 5)
  const run = Math.min(20, Math.round(minutes / 3) + 1)
  const commute = gymTask.buffer_min || 20
  return {
    allyId: ally.task_id,
    allyTitle: allyTask.title,
    targetId: gymTask.id,
    mergeId: runTask.id,
    pitch: `"We're both here for your health. Run to the gym: the run replaces the ${commute}-minute commute, and you still train. Two tasks, one ${minutes}-minute session."`,
    proposal: {
      title: "Run to the gym + strength circuit",
      duration_min: minutes,
      need: "health",
      saved_min: 0,
      cut_scope: [`The ${commute}-minute commute (you run there instead)`, "A separate run"],
      first_move: "Put on your running shoes and head for the gym.",
      action_plan: [{ step: "Run to the gym", minutes: run }, { step: "Strength circuit at the gym", minutes: minutes - run }],
      done_when: "You ran there and finished the circuit.",
    },
  }
}

const CROSS_QUESTIONS: Partial<Record<QuestionType, string>> = {
  purpose: "What are you really for, and why should you get time today?",
  why_so_long: "Why do you need that much time? Break yourself into steps.",
  why_today: "Why does this have to happen today?",
  who_needs: "Who actually needs you done, and could someone else do it?",
  minimal: "What is the smallest useful version of you?",
}
/** A bare "No comment." reads like a bug. Keep it, and let the witness point at its plea (no new facts are invented). */
const witnessLine = (answer: InterrogationResult) => {
  const text = answer.answer.trim()
  if (!/^no comment\.?$/i.test(text)) return text
  return answer.proposal
    ? `“No comment.” …A long pause. “But I could offer the court a deal: ${answer.proposal.title.toLowerCase()}, ${answer.proposal.duration_min} minutes.”`
    : "“No comment.” The witness has no evidence on record for that question."
}

function emptyCase(): Case {
  const data = structuredClone(demoCase)
  return { ...data, constitution: { ...data.constitution, start: "09:00", end: "13:00", fixed_blocks: [] }, tasks: [], rules: { mode: "quick", severity: 0.5, drama: 0.5 } }
}

function archetypeForTask(task: Task): Archetype {
  const text = `${task.title} ${task.category}`.toLowerCase()
  if (/\b(run|running|jog|jogging)\b/.test(text)) return "runner"
  if (/gym|workout|exercise|train|health/.test(text)) return "dumbbell"
  if (/email|inbox|reply/.test(text)) return "envelope"
  if (/math|study|read|exam|book|learning/.test(text)) return "book"
  if (/presentation|slides|deck/.test(text)) return "slides"
  if (/instagram|phone|social|scroll|leisure/.test(text)) return "phone"
  if (/clean|sweep|chores/.test(text)) return "broom"
  if (/shop|cart|groceries|money/.test(text)) return "cart"
  if (/meeting|brief|report|work/.test(text)) return "briefcase"
  if (/family|care|heart/.test(text)) return "heart"
  return "note"
}

function updateMockResult(base: TrialResult, caseData: Case): TrialResult {
  // Only local mock/replay data is adapted to the current case. Anything the backend returned (live or its
  // own fallback) must stay byte-for-byte, or later calls fail its previous_result check with a 409.
  if (!/^(mock|replay)-/.test(base.request_id)) return base
  const demoTasks = {
    slides: caseData.tasks.find((task) => /slides|deck|pitch/i.test(task.title)),
    study: caseData.tasks.find((task) => /study|exam/i.test(task.title)),
    gym: caseData.tasks.find((task) => /gym|workout/i.test(task.title)),
    emails: caseData.tasks.find((task) => /email|inbox/i.test(task.title)),
    leisure: caseData.tasks.find((task) => /tiktok|scroll/i.test(task.title)),
  }
  if (Object.values(demoTasks).every(Boolean) && caseData.tasks.length === 5) {
    const templates = new Map(base.decisions.map((decision) => [decision.persona.archetype, decision]))
    const approvedMinutes = new Map<string, number>([
      [demoTasks.slides!.id, demoTasks.slides!.duration_min],
      [demoTasks.emails!.id, Math.min(10, demoTasks.emails!.duration_min)],
      [demoTasks.study!.id, demoTasks.study!.minimum_min <= 45 ? 45 : demoTasks.study!.duration_min],
      [demoTasks.gym!.id, demoTasks.gym!.duration_min],
      [demoTasks.leisure!.id, 0],
    ])
    const decisions = caseData.tasks.map((task) => {
      const role = task.id === demoTasks.slides!.id ? "slides" : task.id === demoTasks.study!.id ? "book" : task.id === demoTasks.gym!.id ? "dumbbell" : task.id === demoTasks.emails!.id ? "envelope" : "phone"
      const template = templates.get(role) ?? base.decisions[0]
      const approved = approvedMinutes.get(task.id) ?? task.duration_min
      const verdict: Verdict = approved === 0 ? "DISMISSED" : approved < task.duration_min ? "REDUCED" : "APPROVED"
      const title = task.id === demoTasks.slides!.id ? "Finish pitch slides" : task.id === demoTasks.study!.id ? "Focused study for exam" : task.id === demoTasks.gym!.id ? "Gym" : task.id === demoTasks.emails!.id ? "Reply to urgent emails" : task.title
      return {
        ...template,
        task_id: task.id,
        persona: { ...template.persona, archetype: role as Archetype },
        effective_title: title,
        original_min: task.duration_min,
        approved_min: approved,
        saved_min: task.duration_min - approved,
        verdict,
        reason: verdict === "DISMISSED" ? "The court dismisses this request; the day needs its attention elsewhere." : verdict === "REDUCED" ? `The record supports a focused ${approved}-minute version, not the full request.` : "The court finds this request proportionate and grants the time requested.",
        schedule_status: verdict === "DISMISSED" ? "NOT_APPLICABLE" as const : "SCHEDULED" as const,
      }
    })
    let cursor = minutes(caseData.constitution.start)
    const schedule = [demoTasks.slides!, demoTasks.emails!, demoTasks.study!, demoTasks.gym!].map((task) => {
      const decision = decisions.find((item) => item.task_id === task.id)!
      const start = clock(cursor)
      cursor += decision.approved_min + task.buffer_min
      return { task_id: task.id, start, end: clock(cursor), buffer_min: task.buffer_min }
    })
    const approvedTotal = decisions.reduce((total, decision) => total + decision.approved_min, 0)
    const originalTotal = caseData.tasks.reduce((total, task) => total + task.duration_min, 0)
    const allocated = schedule.reduce((total, slot) => total + minutes(slot.end) - minutes(slot.start), 0)
    const fixed = caseData.constitution.fixed_blocks.reduce((total, block) => total + Math.max(0, minutes(block.end) - minutes(block.start)), 0)
    const dayCapacity = Math.max(0, minutes(caseData.constitution.end) - minutes(caseData.constitution.start) - fixed)
    return {
      ...base,
      decisions,
      schedule,
      judge_summary: `Five tasks entered. Four survived. The day belongs to you again. ${originalTotal - approvedTotal} minutes returned to the day.`,
      metrics: { original_min: originalTotal, approved_min: approvedTotal, minutes_recovered: originalTotal - approvedTotal, pending_min: 0, free_capacity_min: Math.max(0, dayCapacity - allocated) },
    }
  }
  const templates = new Map(base.decisions.map((decision) => [decision.task_id, decision]))
  const decisions = caseData.tasks.map((task, index) => {
    const source = templates.get(task.id) ?? base.decisions[index]
    const fallbackVerdict: Verdict = task.mandatory ? "APPROVED" : task.category === "leisure" ? "DISMISSED" : "REDUCED"
    const verdict = source?.verdict ?? fallbackVerdict
    const approved = verdict === "DISMISSED" ? 0 : Math.min(task.duration_min, source?.approved_min ?? task.duration_min)
    return {
      ...(source ?? base.decisions[0]),
      task_id: task.id,
      persona: { ...(source?.persona ?? { emoji: "⚖️", name: "The Applicant", archetype: "note" as const }), archetype: archetypeForTask(task) },
      effective_title: source?.effective_title ?? task.title,
      original_min: task.duration_min,
      approved_min: approved,
      saved_min: task.duration_min - approved,
      verdict,
      schedule_status: verdict === "DISMISSED" ? "NOT_APPLICABLE" as const : "SCHEDULED" as const,
    }
  })
  const schedule = base.schedule.filter((slot) => caseData.tasks.some((task) => task.id === slot.task_id)).map((slot) => ({ ...slot, buffer_min: caseData.tasks.find((task) => task.id === slot.task_id)?.buffer_min ?? 0 }))
  const approvedTotal = decisions.reduce((total, decision) => total + decision.approved_min, 0)
  const originalTotal = caseData.tasks.reduce((total, task) => total + task.duration_min, 0)
  const buffers = schedule.reduce((total, slot) => total + slot.buffer_min, 0)
  const fixed = caseData.constitution.fixed_blocks.reduce((total, block) => total + Math.max(0, minutes(block.end) - minutes(block.start)), 0)
  const dayCapacity = Math.max(0, minutes(caseData.constitution.end) - minutes(caseData.constitution.start) - fixed)
  return {
    ...base,
    decisions,
    schedule,
    judge_summary: `${decisions.filter((decision) => decision.verdict === "APPROVED").length} approved, ${decisions.filter((decision) => decision.verdict === "REDUCED").length} reduced, ${decisions.filter((decision) => decision.verdict === "DISMISSED").length} dismissed. The court returns ${originalTotal - approvedTotal} minutes to the day.`,
    metrics: { original_min: originalTotal, approved_min: approvedTotal, minutes_recovered: originalTotal - approvedTotal, pending_min: 0, free_capacity_min: Math.max(0, dayCapacity - approvedTotal - buffers) },
  }
}

function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number)
  return (hour || 0) * 60 + (minute || 0)
}

function clock(value: number) {
  return `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
}



// Every argument gets the same reading time in every format; bigger formats add rounds, not slowness.
export const ROUNDS_BY_MODE: Record<Case["rules"]["mode"], number> = { immediate: 1, quick: 1, standard: 2, grand: 3 }
const BEAT_MS = { walk: 1100, exchange: 2600, verdict: 1900, sit: 500 }
type CourtPhase = "walking" | "speaking" | "nervous" | "hit" | "verdict" | "sitting"
type Exchange = NonNullable<Decision["exchanges"]>[number]

/** The debate to stage: the backend's rounds when present, otherwise one round from defence and prosecution. */
function scriptFor(decision: Decision, rounds: number): Exchange[] {
  const given = (decision.exchanges ?? []).filter((exchange) => exchange.round <= rounds && exchange.text)
  if (given.length) return given
  // Until the backend sends real rounds, later rounds are built only from what the court already decided.
  const trim = (text: string) => text.replace(/[.\s]+$/, "")
  const script: Exchange[] = [{ round: 1, speaker: "defense", text: decision.defense }, { round: 1, speaker: "prosecution", text: decision.prosecution }]
  if (rounds >= 2) {
    const defence = decision.verdict === "DISMISSED"
      ? decision.suggested_need ? `Then hear my real purpose, Your Honour: ${decision.suggested_need.need}. That is all I can prove.` : "I have no further evidence, Your Honour."
      : decision.first_move ? `Give me ${decision.approved_min} minutes and I start right now: ${trim(decision.first_move)}.` : `Give me ${decision.approved_min} minutes and nothing more.`
    const prosecution = decision.cut_scope.length
      ? `Then this stays out today: ${decision.cut_scope.map(trim).join("; ")}.`
      : decision.verdict === "APPROVED" ? "No further objection, as long as it stays inside its time." : `The record says it plainly: ${trim(cleanReason(decision.reason))}.`
    script.push({ round: 2, speaker: "defense", text: defence }, { round: 2, speaker: "prosecution", text: prosecution })
  }
  if (rounds >= 3) {
    script.push(
      { round: 3, speaker: "defense", text: decision.done_when ? `And I stop the moment this is true: ${trim(decision.done_when)}.` : "I rest my case." },
      { round: 3, speaker: "prosecution", text: `Final word for the court: ${trim(cleanReason(decision.reason))}.` },
    )
  }
  return script
}

function Courtroom({ result, caseData, relations, onSeeDay, onCrossExamine, onPardon, onCallJudge, onAppeal, pardonsUsed, busy, replay, startSeated, onPlayed, onReplayAll, alliance }: {
  result: TrialResult; caseData: Case; relations: InitResult["relations"]; onSeeDay: () => void; onCrossExamine: (id: string) => void; onPardon: (id: string) => void; onCallJudge: (id: string) => void; onAppeal: (id: string) => void; pardonsUsed: number; busy: boolean
  replay?: { taskId: string; key: number } | null
  /** The trial was already staged for this result: come back seated instead of replaying everything. */
  startSeated?: boolean
  onPlayed?: () => void
  onReplayAll?: () => void
  alliance?: string | null
}) {
  const reduceMotion = useReducedMotion()
  const startSeatedRef = useRef(Boolean(startSeated) && !replay)
  const instant = caseData.rules.mode === "immediate" || Boolean(reduceMotion) || startSeatedRef.current
  const timersRef = useRef<number[]>([])
  const [activeIndex, setActiveIndex] = useState(instant ? result.decisions.length : 0)
  const [phase, setPhase] = useState<CourtPhase>(instant ? "sitting" : "walking")
  const [seatedIds, setSeatedIds] = useState<string[]>(() => instant ? result.decisions.map((decision) => decision.task_id) : [])
  const [menuTask, setMenuTask] = useState<string | null>(null)
  const [exchangeIndex, setExchangeIndex] = useState(0)
  const rounds = ROUNDS_BY_MODE[caseData.rules.mode] ?? 1
  const allSeated = activeIndex >= result.decisions.length
  const activeDecision = result.decisions[Math.min(activeIndex, result.decisions.length - 1)]
  const activeTask = caseData.tasks.find((task) => task.id === activeDecision?.task_id)
  const currentExchange = activeDecision ? scriptFor(activeDecision, rounds)[exchangeIndex] : undefined
  const relationTasks = useMemo(() => relations.map((relation) => ({ ...relation, a: caseData.tasks.find((task) => task.id === relation.a), b: caseData.tasks.find((task) => task.id === relation.b) })).filter((relation) => relation.a && relation.b), [relations, caseData.tasks])
  const fixedMinutes = caseData.constitution.fixed_blocks.reduce((total, block) => total + Math.max(0, minutes(block.end) - minutes(block.start)), 0)
  const courtBudget = caseData.budget_min ?? Math.max(0, minutes(caseData.constitution.end) - minutes(caseData.constitution.start) - fixedMinutes)
  const replayKey = replay?.key ?? 0
  // One defendant at a time, so a single testimony can be skipped without touching the others.
  const orderRef = useRef<number[]>([])
  const positionRef = useRef(0)
  const clearTimers = () => { timersRef.current.forEach(window.clearTimeout); timersRef.current = [] }
  const later = (run: () => void, time: number) => { timersRef.current.push(window.setTimeout(run, time)) }
  const seat = (index: number) => {
    const id = result.decisions[index]?.task_id
    if (id) setSeatedIds((ids) => ids.includes(id) ? ids : [...ids, id])
  }
  const runVerdict = (position: number) => {
    const index = orderRef.current[position]
    setActiveIndex(index)
    setPhase("verdict")
    later(() => { setPhase("sitting"); seat(index) }, BEAT_MS.verdict)
    later(() => runDefendant(position + 1), BEAT_MS.verdict + BEAT_MS.sit)
  }
  const runDefendant = (position: number) => {
    if (position >= orderRef.current.length) { setActiveIndex(result.decisions.length); setPhase("sitting"); return }
    positionRef.current = position
    const index = orderRef.current[position]
    const script = scriptFor(result.decisions[index], rounds)
    setActiveIndex(index)
    setExchangeIndex(0)
    setPhase("walking")
    let time = BEAT_MS.walk
    script.forEach((exchange, n) => {
      later(() => { setExchangeIndex(n); setPhase(exchange.speaker === "prosecution" ? "hit" : "speaking") }, time)
      time += BEAT_MS.exchange
    })
    later(() => runVerdict(position), time)
  }
  const skipTestimony = () => { clearTimers(); runVerdict(positionRef.current) }
  useEffect(() => {
    const everyone = result.decisions.map((decision) => decision.task_id)
    const replayIndex = replay ? result.decisions.findIndex((decision) => decision.task_id === replay.taskId) : -1
    const order = replayIndex >= 0 ? [replayIndex] : everyone.map((_, index) => index)
    clearTimers()
    if ((instant && replayIndex < 0) || !order.length) {
      setSeatedIds(everyone)
      setPhase("sitting")
      setActiveIndex(result.decisions.length)
      return
    }
    setSeatedIds(replayIndex >= 0 ? everyone.filter((id) => id !== replay?.taskId) : [])
    if (replayIndex < 0) onPlayed?.()
    orderRef.current = order
    runDefendant(0)
    return clearTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseData.rules.mode, instant, result.decisions.length, replayKey, rounds])
  const verdicts = ["APPROVED", "REDUCED", "DISMISSED"] as const
  const byVerdict = (verdict: Verdict) => result.decisions.filter((decision) => decision.verdict === verdict && seatedIds.includes(decision.task_id))
  const skip = () => { clearTimers(); setSeatedIds(result.decisions.map((decision) => decision.task_id)); setPhase("sitting"); setActiveIndex(result.decisions.length) }
  return <section className={`new-stage courtroom-new ${phase === "hit" && !reduceMotion ? "court-shake" : ""}`}>
    <div className="courtroom-topline"><div><span className="new-eyebrow">THE EVIDENCE IS HEARD</span><h1>The Courtroom</h1><p>Every matter gets its moment. Every minute has a witness.</p></div><div className="court-controls">{!allSeated && phase !== "verdict" && phase !== "sitting" && <button className="skip-verdict skip-one" onClick={skipTestimony}><ArrowRight /> Skip this testimony</button>}{!allSeated && <button className="skip-verdict" onClick={skip}><ArrowDown /> Skip all testimony</button>}{allSeated && onReplayAll && <button className="skip-verdict" onClick={onReplayAll}><ArrowLeft /> Replay the trial</button>}</div></div>
    <div className={`court-scene ${phase === "hit" ? "scene-objection" : ""} ${phase === "verdict" && activeDecision ? `scene-verdict scene-tone-${verdictTone[activeDecision.verdict]}` : ""}`}>
      <div className="court-architecture" aria-hidden="true"><div className="court-coffer" /><div className="court-column court-column-left" /><div className="court-column court-column-right" /><div className="court-sconce court-sconce-left" /><div className="court-sconce court-sconce-right" /><div className="court-parquet" /></div>
      <div className="scene-curtain" aria-hidden="true" />
      <AnimatePresence>{alliance && <motion.div className="alliance-banner" initial={{ opacity: 0, y: -12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 16 }}><span>💞</span>{alliance}</motion.div>}</AnimatePresence>
      <span className="granted-budget-stamp">Budget: {courtBudget} min</span>
      <div className="scene-title"><span>IN THE MATTER OF</span><strong>YOUR DAY</strong></div>
      <div className="judge-bench-scene"><JudgeCharacter striking={phase === "verdict"} /><div className="judge-nameplate"><span>JUDGE&apos;S BENCH</span><strong>{phase === "verdict" ? "Order!" : "The Honourable Day"}</strong></div></div>
      <div className="queue-area"><span className="scene-label">THE QUEUE</span>{result.decisions.map((decision, index) => {
        const task = caseData.tasks.find((item) => item.id === decision.task_id)
        if (!task) return null
        return <motion.div key={task.id} className={`queue-defendant ${index === activeIndex && !allSeated ? "in-spotlight" : ""}`} animate={!reduceMotion && index === activeIndex && !allSeated ? { x: [0, 20, 38], y: [0, -5, 0] } : { x: 0 }} transition={{ duration: 1.1 }}><TaskCharacter archetype={artFor(decision, caseData.tasks)} compact state={index === activeIndex && !allSeated ? phase === "verdict" ? "speaking" : phase : "idle"} prisonerNumber={index + 1} variant="defendant" label={`${decision.effective_title}, queue`} /><span>{decision.effective_title}</span></motion.div>
      })}</div>
      <div className="witness-spot"><span className="scene-label">THE WITNESS STAND</span><div className="witness-rail" />{activeTask && !allSeated && <motion.div className="stand-witness" key={`${activeTask.id}-${replayKey}`} initial={reduceMotion ? false : { opacity: 0, x: -170, y: 60, rotate: -25, scaleX: 0.7, scaleY: 1.2 }} animate={reduceMotion ? { opacity: 1 } : { opacity: [0, 1, 1, 1, 1], x: [-170, -90, -20, 0, 0], y: [60, -70, -30, 6, 0], rotate: [-25, 160, 340, 360, 360], scaleX: [0.7, 1, 1, 1.25, 1], scaleY: [1.2, 1, 1, 0.75, 1] }} transition={{ duration: 0.85, ease: "easeOut", times: [0, 0.35, 0.65, 0.85, 1] }}>{phase === "walking" && <motion.span className="ahem-bubble" initial={{ opacity: 0, scale: 0.4, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: 0.55, type: "spring", stiffness: 400, damping: 12 }}>Ahem!</motion.span>}<TaskCharacter archetype={artFor(activeDecision, caseData.tasks)} state={phase === "verdict" ? "speaking" : phase} prisonerNumber={activeIndex + 1} variant="defendant" label={`${activeTask.title}, ${phase}`} /><span>{activeTask.title}</span>{(phase === "speaking" || phase === "nervous") && currentExchange && <motion.div key={`defence-${activeIndex}-${exchangeIndex}`} className="defense-bubble" initial={{ opacity: 0, scale: 0.9, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}><span>{rounds > 1 ? `ROUND ${currentExchange.round} OF ${rounds} · ` : ""}{activeDecision.persona.name.toUpperCase()} · {currentExchange.round > 1 ? "REBUTTAL" : "THE DEFENCE"}</span><p>{currentExchange.text}</p></motion.div>}{phase === "hit" && currentExchange && <motion.div key={`prosecution-${activeIndex}-${exchangeIndex}`} className="prosecution-bubble" initial={{ opacity: 0, scale: 0.8, x: 30 }} animate={{ opacity: 1, scale: 1, x: 0 }}><span>{rounds > 1 ? `ROUND ${currentExchange.round} OF ${rounds} · ` : ""}OBJECTION! · THE PROSECUTION</span><p>{currentExchange.text}</p></motion.div>}</motion.div>}
        {allSeated && <div className="empty-witness"><span>The room is in order.</span><span>{result.judge_summary}</span></div>}
      </div>
      <div className="prosecutor-area"><ProsecutorCharacter objecting={phase === "hit"} /><span>THE PROSECUTOR</span>{phase === "hit" && <strong>OBJECTION!</strong>}</div>
      <AnimatePresence>{phase === "verdict" && activeDecision && !allSeated && <motion.div key={`verdict-${activeDecision.task_id}-${replayKey}`} className={`verdict-overlay ${verdictTone[activeDecision.verdict]}`} initial={{ opacity: 0, scale: 1.6, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: -3 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}><small>THE COURT RULES · {activeDecision.effective_title}</small><strong>{activeDecision.verdict}</strong><span>{activeDecision.original_min} → {activeDecision.approved_min} min{activeDecision.saved_min > 0 ? ` · SAVED ${activeDecision.saved_min} MIN` : ""}</span><p>{cleanReason(activeDecision.reason)}</p></motion.div>}</AnimatePresence>
      <div className="court-floor" />
      <div className="bench-row">{verdicts.map((verdict) => <section key={verdict} className={`court-bench ${verdictTone[verdict]}`}><header><strong>{verdict}</strong><span>{byVerdict(verdict).length} seated</span></header><div className="bench-seats">{byVerdict(verdict).map((decision) => {
        const task = caseData.tasks.find((item) => item.id === decision.task_id)
        if (!task) return null
        const activeMenu = menuTask === task.id
        const pardonAvailable = pardonsUsed < 2 && decision.verdict !== "APPROVED"
        return <div className="seated-character" key={task.id}><TaskCharacter archetype={artFor(decision, caseData.tasks)} state={activeMenu ? "speaking" : "sitting"} prisonerNumber={result.decisions.findIndex((item) => item.task_id === task.id) + 1} variant={decision.verdict === "DISMISSED" ? "defendant" : "on-duty"} label={`Open actions for ${decision.effective_title}`} onClick={() => setMenuTask(activeMenu ? null : task.id)} /><span>{decision.effective_title}</span>{activeMenu && <div className="radial-menu"><button onClick={() => onCrossExamine(task.id)}>Cross-examine</button>{pardonAvailable && <button disabled={busy} onClick={() => { setMenuTask(null); onPardon(task.id) }}>Pardon ({2 - pardonsUsed} left)</button>}{decision.verdict !== "DISMISSED" && <button onClick={() => onCallJudge(task.id)}>Call the judge</button>}{decision.verdict === "REDUCED" && <button onClick={() => onAppeal(task.id)}>Appeal</button>}</div>}</div>
      })}</div></section>)}</div>
      <div className="time-recovered"><span className="hourglass-icon">⌛</span><div><small>TIME RECOVERED</small><strong>{result.metrics.minutes_recovered}<em> min</em></strong></div><div className="jar-fill"><i style={{ height: `${Math.min(100, result.metrics.minutes_recovered / 1.8)}%` }} /></div></div>
      {relationTasks.length > 0 && <div className="relations-legend" aria-label="Task relationships">{relationTasks.map((relation) => <span key={`${relation.a?.id}-${relation.b?.id}`} className={`relation-${relation.type}`}>{relation.type === "ally" ? "🤝" : relation.type === "rival" ? "⚡" : "⛓"} {relation.a?.title} ↔ {relation.b?.title}</span>)}</div>}
    </div>
    <div className="courtroom-footer"><span><i /> {allSeated ? "The record is complete" : `${activeIndex + 1} of ${result.decisions.length} matters · ${phase === "hit" ? "OBJECTION!" : phase === "verdict" ? "The judge is deliberating" : phase === "speaking" ? "Defence is heard" : "The court is in session"}`}</span><button onClick={() => { skip(); onSeeDay() }}>See my day <ArrowRight /></button></div>
  </section>
}

function Sentence({ result, caseData, relations, onBack, onCrossExamine, openOrder, onStart, pardonIds, activeTaskId }: {
  result: TrialResult; caseData: Case; relations: InitResult["relations"]; onBack: () => void; onCrossExamine: (id: string) => void; openOrder: (id: string) => void; onStart: (id: string) => void; pardonIds: string[]; activeTaskId: string | null
}) {
  const scheduled = result.schedule.map((slot) => ({ slot, task: caseData.tasks.find((task) => task.id === slot.task_id), decision: result.decisions.find((decision) => decision.task_id === slot.task_id) })).filter((item) => item.task && item.decision)
  const allocatedMinutes = scheduled.reduce((total, item) => total + minutes(item.slot.end) - minutes(item.slot.start), 0)
  const demoSentence = result.decisions.length === 5 && caseData.tasks.some((task) => /tiktok/i.test(task.title))
  const dayStart = minutes(caseData.constitution.start)
  const dayEnd = minutes(caseData.constitution.end)
  const span = Math.max(1, dayEnd - dayStart)
  const fixed = caseData.constitution.fixed_blocks
  const timelineEntries = [
    ...scheduled.map(({ slot, task, decision }) => ({ start: slot.start, end: slot.end, title: decision?.effective_title ?? task?.title ?? "Task", type: "task", task, decision, buffer: slot.buffer_min, rest: slot.rest_after_min ?? 0 })),
    ...fixed.map((block) => ({ start: block.start, end: block.end, title: block.label, type: "fixed", buffer: 0, rest: 0, task: undefined, decision: undefined })),
  ].sort((a, b) => a.start.localeCompare(b.start))
  // The phase the user is in: the task they started, or else whatever the clock says is happening now.
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes()
  const isCurrent = (entry: { type: string; start: string; end: string; task?: Task }) => activeTaskId
    ? entry.type === "task" && entry.task?.id === activeTaskId
    : minutes(entry.start) <= nowMinutes && nowMinutes < minutes(entry.end)
  const freeGaps: { start: number; end: number }[] = []
  let cursor = dayStart
  timelineEntries.forEach((entry) => {
    const start = minutes(entry.start)
    const end = minutes(entry.end)
    if (start > cursor) freeGaps.push({ start: cursor, end: start })
    cursor = Math.max(cursor, end)
  })
  if (cursor < dayEnd) freeGaps.push({ start: cursor, end: dayEnd })
  return <section className="new-stage sentence-new">
    <div className="courtroom-topline sentence-topline"><div><span className="new-eyebrow">THE SENTENCE · YOUR DAY, RETURNED</span><h1>{demoSentence ? "Five tasks entered. Four survived. The day belongs to you again." : "Here's your day."}</h1><p>{demoSentence ? "A considered plan, with room left to breathe." : "A considered plan, with room left to breathe."}</p></div><button className="back-to-court" onClick={onBack}><ArrowLeft /> Back to the courtroom</button></div>
    <div className="sentence-summary-new"><div><small>TIME RECOVERED</small><strong>{result.metrics.minutes_recovered}<em> min</em></strong></div><p>{demoSentence ? `Allocated ${allocatedMinutes} · ${result.metrics.minutes_recovered} MINUTES RECOVERED · ${result.metrics.free_capacity_min} unallocated.` : result.judge_summary}</p><span>FREE CAPACITY <b>{result.metrics.free_capacity_min} MIN</b></span></div>
    {pardonIds.length > 0 && <div className="pardon-banner"><ShieldCheck /> Pardoned and returned to the day: {pardonIds.map((id) => caseData.tasks.find((task) => task.id === id)?.title).filter(Boolean).join(", ")}</div>}
    <div className="day-overview"><section className="timeline-new"><div className="overview-head"><div><span className="new-eyebrow">A CLEARER DAY</span><h2>The timeline</h2></div><span>{caseData.constitution.start} — {caseData.constitution.end}</span></div><div className="timeline-axis"><div className="hour-labels">{Array.from({ length: Math.floor(span / 60) + 1 }, (_, index) => dayStart + index * 60).filter((time) => time <= dayEnd).map((time) => <span key={time} style={{ top: `${((time - dayStart) / span) * 100}%` }}>{clock(time)}</span>)}</div><div className="timeline-track-new">{freeGaps.map((gap) => <div key={`free-${gap.start}`} className="free-gap-new" style={{ top: `${((gap.start - dayStart) / span) * 100}%`, height: `${((gap.end - gap.start) / span) * 100}%` }}><span>Free</span></div>)}{timelineEntries.map((entry, index) => <div key={`${entry.type}-${index}`} className={`time-block-new ${entry.type === "fixed" ? "fixed-block-new" : ""} ${isCurrent(entry) ? "is-current" : ""}`} style={{ top: `${((minutes(entry.start) - dayStart) / span) * 100}%`, height: `${Math.max(3, ((minutes(entry.end) - minutes(entry.start)) / span) * 100)}%` }}><strong>{entry.title}</strong><small>{entry.start}–{entry.end}</small>{entry.type === "task" && entry.buffer > 0 && <span className="buffer-hatch" style={{ width: `${Math.min(55, (entry.buffer / Math.max(minutes(entry.end) - minutes(entry.start), 1)) * 100)}%` }} title={`${entry.buffer} min travel/setup`} />}{entry.type === "task" && (entry.rest ?? 0) > 0 && <span className="rest-band" style={{ height: `${Math.min(40, ((entry.rest ?? 0) / Math.max(minutes(entry.end) - minutes(entry.start), 1)) * 100)}%` }} title={`${entry.rest} min break`}>break</span>}{isCurrent(entry) && <span className="now-chip">NOW</span>}</div>)}</div></div><div className="timeline-legend-new"><span><i className="legend-scheduled" />Scheduled</span><span><i className="legend-hatched" />Travel/setup</span><span><i className="legend-free-dashed" />Free</span></div></section>
      <section className="day-tiles"><div className="overview-head"><div><span className="new-eyebrow">YOUR COURT ORDERS</span><h2>Today&apos;s matters</h2></div><span>{scheduled.length} scheduled</span></div><div className="order-tile-list">{result.decisions.map((decision) => {
        const task = caseData.tasks.find((item) => item.id === decision.task_id)
        const slot = result.schedule.find((item) => item.task_id === decision.task_id)
        if (!task) return null
        return <div className="day-task-tile" key={task.id} role="button" tabIndex={0} aria-label={`Open court order for ${decision.effective_title}`} onClick={() => openOrder(task.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openOrder(task.id) } }}><TaskCharacter archetype={artFor(decision, caseData.tasks)} variant="on-duty" compact label={`${task.title}, on duty`} /><span className="tile-main"><strong>{decision.effective_title}</strong><small>{slot ? `${slot.start}–${slot.end}` : "Not scheduled today"}</small><span className={`verdict-badge ${verdictTone[decision.verdict]}`}>{decision.verdict}{pardonIds.includes(task.id) && " · PARDONED"}</span></span>{decision.saved_min > 0 && <span className="tile-saved">SAVED {decision.saved_min} MIN</span>}{slot && decision.verdict !== "DISMISSED" && <button className="tile-start" onClick={(event) => { event.stopPropagation(); onStart(task.id) }}>▶ Start</button>}<ArrowRight /></div>
      })}</div></section>
    </div>
    {relations.length > 0 && <div className="sentence-relations"><span className="new-eyebrow">THE RELATIONSHIPS</span>{relations.map((relation) => <span key={`${relation.a}-${relation.b}`} className={`relation-${relation.type}`}>{relation.type === "ally" ? "🤝" : relation.type === "rival" ? "⚡" : "⛓"} {caseData.tasks.find((task) => task.id === relation.a)?.title} — {relation.reason}</span>)}</div>}
    <button className="sentence-done-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>The day is yours again <Sparkles /></button>
  </section>
}

// "Call the judge" suggestions that make sense for each kind of task.
const JUDGE_PRESETS: Record<Archetype, string[]> = {
  dumbbell: ["Home workout instead", "Shorter, harder session", "No equipment", "Split into two sessions"],
  envelope: ["Only the urgent ones", "Use reply templates", "Do it from my phone", "Batch in two rounds"],
  book: ["Make it easier", "Active recall only", "Past papers instead", "Split into two sessions"],
  slides: ["Draft first, polish later", "Outline only", "Reuse old slides", "Rehearse instead of polishing"],
  phone: ["Screen-free break instead", "Set a 10-minute timer", "Swap it for a walk", "Phone in another room"],
  broom: ["Quick 10-minute tidy", "One room only", "Share it with someone"],
  cart: ["Order online instead", "Essentials only", "Combine with other errands"],
  briefcase: ["Smallest useful deliverable", "Split it in two", "Delegate part of it"],
  heart: ["A short call instead", "Plan it together", "Send a message first"],
  note: ["Make it easier", "Split it in two"],
  runner: ["Shorter, faster run", "Run-walk intervals", "Swap for a brisk walk"],
}

/** The character to draw: our title-based guess wins over the backend's, which can be off (e.g. a run drawn as a phone). */
function artFor(decision: Decision, tasks: Task[]): Archetype {
  const task = tasks.find((item) => item.id === decision.task_id)
  const local = task ? archetypeForTask(task) : "note"
  return local !== "note" ? local : decision.persona.archetype
}

function CourtOrder({ task, decision, slot, caseData, revision, busy, error, onRevise, onClose, onCrossExamine, onStart }: {
  task: Task; decision: Decision; slot?: TrialResult["schedule"][number]; caseData: Case; revision: ReviseResult | null; busy: boolean; error: string; onRevise: (instruction: string) => void; onClose: () => void; onCrossExamine: () => void; onStart: () => void
}) {
  const reduceMotion = useReducedMotion()
  const [checked, setChecked] = useState<boolean[]>(decision.action_plan.map(() => false))
  const [expanded, setExpanded] = useState<number | null>(0)
  const [focus, setFocus] = useState(false)
  const [seconds, setSeconds] = useState(60)
  const [actual, setActual] = useState("")
  const [showDuration, setShowDuration] = useState(false)
  const [doneMinutes, setDoneMinutes] = useState<number | null>(null)
  const [instruction, setInstruction] = useState("")
  const [lastAsked, setLastAsked] = useState<string | null>(null)
  const presetsForTask = [...(JUDGE_PRESETS[artFor(decision, caseData.tasks)] ?? JUDGE_PRESETS.note), "Different first move"]
  const actionPlan = revision?.action_plan ?? decision.action_plan
  const firstMove = revision?.first_move ?? decision.first_move ?? "Open the task and take the first small step."
  const doneWhen = revision?.done_when ?? decision.done_when ?? "The agreed scope is complete."
  const activeStep = checked.findIndex((item) => !item)
  useEffect(() => {
    if (!focus || reduceMotion) return
    const timer = window.setInterval(() => setSeconds((value) => value > 0 ? value - 1 : 0), 1000)
    return () => window.clearInterval(timer)
  }, [focus, reduceMotion])
  const submitRevision = (preset?: string) => {
    const text = preset ?? instruction.trim()
    if (!text) return
    setLastAsked(text)
    onRevise(text)
    setInstruction("")
  }
  const startTime = minutes(slot?.start ?? caseData.constitution.start) + (slot?.buffer_min ?? 0)
  let cursor = startTime
  return <div className="order-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><motion.aside className="court-order-sheet" role="dialog" aria-modal="true" aria-labelledby="order-title" initial={reduceMotion ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }}>
    <div className="order-sheet-header"><button className="order-close" onClick={onClose} aria-label="Close court order"><X /></button><div className="order-hero-character"><TaskCharacter archetype={artFor(decision, caseData.tasks)} variant="on-duty" state="idle" label={`${task.title}, on duty`} /></div><div className="order-heading-copy"><span className="new-eyebrow">COURT ORDER NO. {task.id.toUpperCase()}</span><h2 id="order-title">{decision.effective_title}</h2><p>{slot ? `${slot.start}–${slot.end}` : "Unscheduled · make room when ready"} · {decision.approved_min} min approved</p><span className={`verdict-badge ${verdictTone[decision.verdict]}`}>{decision.verdict}</span>{decision.saved_min > 0 && <strong className="order-saved">SAVED {decision.saved_min} MIN</strong>}</div></div>
    {decision.cut_scope.length > 0 && <div className="not-today"><span>NOT TODAY</span><ul>{decision.cut_scope.map((item) => <li key={item}><s>{item}</s></li>)}</ul></div>}
    <div className="order-sheet-body"><section className="first-move-card"><span>⚡ FIRST MOVE</span><p>{firstMove}</p><button onClick={onStart}><ArrowRight /> Start</button></section>
      <section className="order-steps"><div className="order-steps-head"><span className="new-eyebrow">THE PLAN</span><h3>One step at a time.</h3></div>{actionPlan.map((step, index) => {
        const begin = cursor
        cursor += step.minutes
        const isActive = activeStep === index
        return <article className={`order-step ${checked[index] ? "step-checked" : ""} ${isActive ? "step-active" : ""}`} key={`${step.step}-${index}`}><div className="order-step-main"><label><input type="checkbox" checked={Boolean(checked[index])} aria-label={`Mark complete: ${step.step}`} onChange={(event) => setChecked((previous) => previous.map((item, itemIndex) => itemIndex === index ? event.target.checked : item))} /><span className="step-checkmark"><Check /></span></label><button className="step-expand" onClick={() => setExpanded(expanded === index ? null : index)} aria-expanded={expanded === index}><span>{clock(begin)}–{clock(begin + step.minutes)}</span><strong>{step.step}</strong><small>{step.minutes} min</small><ChevronDown /></button>{isActive && focus && <div className="focus-timer" aria-live="polite"><svg viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="19"/><circle className="timer-progress" cx="23" cy="23" r="19" style={{ strokeDashoffset: `${119.4 * (1 - seconds / 60)}` }} /></svg><span>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</span></div>}</div>{expanded === index && <div className="step-details">{step.detail && <p>{step.detail}</p>}{step.tip && <p className="step-tip">💡 {step.tip}</p>}{!step.detail && !step.tip && <p>Keep this step small, focused, and easy to finish.</p>}</div>}</article>
      })}</section>
      <div className="done-when-card"><span>DONE WHEN</span><p>{doneWhen}</p></div>
      <div className="mark-done-row">{doneMinutes !== null ? <span className="done-confirmation"><Check /> Done · took {doneMinutes} min</span> : showDuration ? <div className="actual-duration"><label htmlFor="actual-duration">How long did it really take?</label><input id="actual-duration" type="number" min="1" value={actual} onChange={(event) => setActual(event.target.value)} placeholder="Minutes" /><button onClick={() => { if (Number(actual) > 0) { setDoneMinutes(Number(actual)); setShowDuration(false) } }} disabled={Number(actual) <= 0}>Save actual</button></div> : <button className="mark-done-button" onClick={() => setShowDuration(true)}><Check /> Mark done</button>}</div>
      {decision.verdict !== "DISMISSED" && <section className="call-judge-panel"><div className="judge-panel-head"><JudgeCharacter /><div><span className="new-eyebrow">CALL THE JUDGE</span><h3>Need a different order?</h3><p>Ask for a rewrite that fits real life.</p></div></div><div className="judge-presets">{presetsForTask.map((preset) => <button key={preset} className={lastAsked === preset ? "preset-asked" : ""} onClick={() => submitRevision(preset)}>{preset}</button>)}</div><form className="judge-instruction" onSubmit={(event) => { event.preventDefault(); submitRevision() }}><input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Or tell the judge what needs to change…" /><button disabled={!instruction.trim()} aria-label="Send instruction"><Send /></button></form>{busy && <div className="judge-loading" role="status"><JudgeCharacter striking /><span>The judge is rewriting your order…</span></div>}{error && !busy && <p className="revision-error" role="alert">{error}</p>}{revision && !busy && !error && <p className="revision-success"><Check /> {lastAsked ? `Revised: “${lastAsked}”. The plan above is updated.` : "The detailed order is in."}</p>}</section>}
      <button className="order-cross-examine" onClick={onCrossExamine}>Cross-examine this task</button>
    </div>
  </motion.aside></div>
}

function CrossExamination({ task, decision, busy, answer, onAsk, onAppeal, onClose, pact, onPact }: {
  task: Task; decision?: Decision; busy: boolean; answer: InterrogationResult | null; onAsk: (type: QuestionType, text?: string) => void; onAppeal: (fact: string) => void; onClose: () => void
  pact?: Pact | null; onPact?: () => void
}) {
  const [fact, setFact] = useState("")
  return <div className="order-overlay cross-exam-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="cross-exam-card" role="dialog" aria-modal="true" aria-labelledby="cross-exam-title"><button className="order-close" onClick={onClose} aria-label="Close cross-examination"><X /></button><span className="new-eyebrow">THE WITNESS STAND</span><h2 id="cross-exam-title">Cross-examine {decision?.effective_title ?? task.title}</h2><p>One careful question can make room for a more reasonable plea.</p><div className="cross-question-list">{QUESTIONS_BY_VERDICT[decision?.verdict ?? "APPROVED"].map((question) => <button key={question.label} disabled={busy} onClick={() => onAsk(question.type, question.text)}>{question.label}<ArrowRight /></button>)}</div>{pact && answer?.question_type === "why_today" && <motion.div className="pact-card" initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}><span>🤝 “I CAN COME BACK TODAY — IF I PARTNER WITH {pact.allyTitle.toUpperCase()}”</span><strong>{pact.proposal.title}</strong><p>{pact.pitch}</p><ol>{pact.proposal.action_plan.map((step: { step: string; minutes: number }) => <li key={step.step}>{step.step} · {step.minutes} min</li>)}</ol><small>Not today: {pact.proposal.cut_scope.join(" · ")}</small><button disabled={busy} onClick={onPact}>🤝 Partner with {pact.allyTitle} — back to trial</button></motion.div>}{answer && <div className="cross-answer"><span>THE WITNESS ANSWERS</span><p>{pact && answer.question_type === "why_today" && /^\s*no comment/i.test(answer.answer) ? `“Not on my own, Your Honour… but I can partner with ${pact.allyTitle}.”` : witnessLine(answer)}</p>{answer.proposal && <div className="cross-plea"><strong>🤝 Plea deal offered: {answer.proposal.title} · {answer.proposal.duration_min} min</strong><p>{answer.proposal.first_move}</p><input value={fact} onChange={(event) => setFact(event.target.value)} placeholder="Add a new fact (optional)" /><button onClick={() => onAppeal(fact)}>Accept appeal</button></div>}</div>}</section></div>
}

export default function TrialExperience() {
  const [caseData, setCaseData] = useState<Case>(emptyCase)
  const [docketText, setDocketText] = useState("")
  const [initData, setInitData] = useState<InitResult | null>(null)
  const [result, setResult] = useState<TrialResult | null>(null)
  const [stage, setStage] = useState<"docket" | "courtroom" | "sentence">("docket")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [source, setSource] = useState("Ready")
  const [pardonIds, setPardonIds] = useState<string[]>([])
  const [crossTaskId, setCrossTaskId] = useState<string | null>(null)
  const [crossAnswer, setCrossAnswer] = useState<InterrogationResult | null>(null)
  const [orderTaskId, setOrderTaskId] = useState<string | null>(null)
  const [revision, setRevision] = useState<ReviseResult | null>(null)
  const [replay, setReplay] = useState<{ taskId: string; key: number } | null>(null)
  // The exact case the court judged. Later calls must send it unchanged, even if the docket is edited afterwards.
  const trialCaseRef = useRef<Case | null>(null)
  const trialCase = () => trialCaseRef.current ?? caseData
  const [seenTrialId, setSeenTrialId] = useState<string | null>(null)
  const [replayAllKey, setReplayAllKey] = useState(0)
  const requestedRevision = useRef<string | null>(null)
  const currentTask = caseData.tasks.find((task) => task.id === crossTaskId) ?? null
  const orderTask = caseData.tasks.find((task) => task.id === orderTaskId) ?? null
  const orderDecision = result?.decisions.find((decision) => decision.task_id === orderTaskId) ?? null
  const orderSlot = result?.schedule.find((slot) => slot.task_id === orderTaskId)

  /** The backend lost its in-memory session (restart): judge the same case again and keep going. */
  const reconvene = async () => {
    const judged = trialCaseRef.current
    if (!judged) return
    setBusy(true)
    setError("")
    try {
      const response = await run(judged)
      setResult(response)
      setReplay(null)
      setSeenTrialId(response.request_id)
      setSource(response.source === "live" ? "Live" : response.source === "replay" ? "Replay" : "Fallback")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The court could not reconvene.")
    } finally { setBusy(false) }
  }
  const beginTrial = async () => {
    setBusy(true)
    setError("")
    try {
      const currentCase = { ...caseData, rules: { ...caseData.rules } }
      trialCaseRef.current = currentCase
      const rawResult = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_USE_MOCK === "true" ? await run(currentCase) : await runReplay()
      const response = updateMockResult(rawResult, currentCase)
      setResult(response)
      setReplay(null)
      setAlliance(null)
      setMergedInto({})
      setSource(response.source === "live" ? "Live" : response.source === "replay" ? "Replay" : "Fallback")
      setStage("courtroom")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The court could not begin this trial.")
    } finally { setBusy(false) }
  }

  const openCross = (id: string) => { setCrossTaskId(id); setCrossAnswer(null) }
  const askCross = async (type: QuestionType, text?: string) => {
    if (!result || !currentTask || busy) return
    setBusy(true)
    try {
      const base = { case: trialCase(), task_id: currentTask.id, previous_result: result, base_revision: result.revision }
      // Typed questions carry the plea logic but often come back as a bare "No comment." for tasks without facts.
      // In that case ask the same thing as a free question so the witness actually answers in character.
      const response = await interrogate({ ...base, question_type: text ? "free" : type, question_text: text ?? null })
      if (/^\s*no comment\.?\s*$/i.test(response.answer)) {
        try {
          const spoken = await interrogate({ ...base, question_type: "free", question_text: `${CROSS_QUESTIONS[type] ?? "Explain yourself."} Answer in character in one or two sentences; if you have no evidence, admit it but still answer.` })
          if (spoken.answer.trim() && !/^\s*no comment/i.test(spoken.answer)) {
            setCrossAnswer({ ...response, answer: spoken.answer, proposal: response.proposal ?? spoken.proposal })
            return
          }
        } catch {
          // Keep the typed answer if the follow-up fails.
        }
      }
      setCrossAnswer(response)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The witness could not be heard.") }
    finally { setBusy(false) }
  }
  const appealTask = async (fact: string) => {
    // The backend only re-sentences with an accepted plea; a bare fact would replay the same verdict.
    if (!result || !currentTask || !crossAnswer?.proposal) return
    setBusy(true)
    // Don't keep the user waiting on the sheet: back to the courtroom at once, the bench deliberates there.
    setCrossTaskId(null)
    setStage("courtroom")
    setDeliberating(`Appeal of ${currentTask.title}`)
    try {
      const updated = await appeal({ case: trialCase(), task_id: currentTask.id, new_fact: fact.trim() || null, accepted_replacement: crossAnswer?.proposal ?? null, previous_result: result, base_revision: result.revision })
      setResult(updated)
      setCrossTaskId(null)
      setCrossAnswer(null)
      // Back to the jury: the appealed task takes the stand again and is re-sentenced.
      setReplay({ taskId: currentTask.id, key: Date.now() })
      setSeenTrialId(updated.request_id)
      setStage("courtroom")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The appeal could not be heard.") }
    finally { setBusy(false); setDeliberating(null) }
  }
  const pardonTask = async (id: string) => {
    if (!result || pardonIds.length >= 2) return
    setBusy(true)
    setStage("courtroom")
    setDeliberating(`Pardon for ${caseData.tasks.find((task) => task.id === id)?.title ?? "the defendant"}`)
    try {
      const input: PardonInput = { case: trialCase(), task_id: id, previous_result: result, base_revision: result.revision, pardon: true }
      const updated = await pardon(input)
      setResult(updated)
      setReplay({ taskId: id, key: Date.now() })
      setSeenTrialId(updated.request_id)
      setStage("courtroom")
      setPardonIds((previous) => [...previous, id])
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The pardon could not be granted.") }
    finally { setBusy(false); setDeliberating(null) }
  }
  // Dismissed task id -> the ally it merged into through a pact (display only; the backend judged the ally's appeal).
  const [mergedInto, setMergedInto] = useState<Record<string, string>>({})
  // Shown in the courtroom once two tasks have made a pact: their relationship improved.
  const [alliance, setAlliance] = useState<string | null>(null)
  const pactFor = (taskId: string | null) => {
    const decision = result?.decisions.find((item) => item.task_id === taskId)
    return decision && !mergedInto[decision.task_id] ? buildPact(decision, caseData.tasks, result?.decisions ?? []) : null
  }
  const acceptPact = async (taskId: string | null) => {
    const pact = pactFor(taskId)
    if (!result || !pact || !taskId) return
    const gymTitle = caseData.tasks.find((task) => task.id === taskId)?.title ?? "The defendant"
    setBusy(true)
    setCrossTaskId(null)
    setStage("courtroom")
    setDeliberating(`Pact: ${gymTitle} + ${pact.allyTitle}`)
    try {
      // The dismissed task takes the pact; its ally is merged into it and the commute buffer goes to zero.
      const send = (proposal: Proposal) => appeal({
        case: trialCase(), task_id: pact.targetId,
        new_fact: `${gymTitle} and ${pact.allyTitle} agreed a pact: running to the gym replaces the commute, so both are served in one session.`,
        accepted_replacement: { ...proposal, buffer_min: 0 }, merge_task_ids: [pact.mergeId],
        previous_result: result, base_revision: result.revision,
      })
      let updated: TrialResult
      try {
        updated = await send(pact.proposal)
      } catch (cause) {
        // The backend may require a strictly smaller replacement: offer the same pact five minutes shorter.
        if (!(cause instanceof Error) || !/smaller/i.test(cause.message)) throw cause
        const minutes = pact.proposal.duration_min - 5
        const run = pact.proposal.action_plan[0].minutes
        updated = await send({ ...pact.proposal, duration_min: minutes, action_plan: [{ step: "Run to the gym", minutes: run }, { step: "Strength circuit at the gym", minutes: minutes - run }] })
      }
      setResult(updated)
      setMergedInto((current) => ({ ...current, [pact.mergeId]: pact.targetId }))
      setAlliance(`${caseData.tasks.find((task) => task.id === pact.targetId)?.title ?? "Gym"} + ${caseData.tasks.find((task) => task.id === pact.mergeId)?.title ?? "Run"} are now allies: one session, no commute`)
      setReplay({ taskId: pact.targetId, key: Date.now() })
      setSeenTrialId(updated.request_id)
      setStage("courtroom")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The court could not hear the pact.") }
    finally { setBusy(false); setDeliberating(null) }
  }
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  // Shown over the courtroom while an appeal or pardon is being decided.
  const [deliberating, setDeliberating] = useState<string | null>(null)
  // The task the user is working on now: highlighted on the timeline even after the focus room closes.
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const focusTask = caseData.tasks.find((task) => task.id === focusTaskId) ?? null
  const focusDecision = result?.decisions.find((decision) => decision.task_id === focusTaskId) ?? null
  const startFocus = (id: string) => {
    setFocusTaskId(id)
    setActiveTaskId(id)
    // Load the detailed order for this task if we don't have it yet.
    if (result && revision?.task_id !== id && result.decisions.find((decision) => decision.task_id === id)?.verdict !== "DISMISSED") void askJudge(id, "detail")
  }
  /** Talking to the task during the session: a free-form question that never changes the schedule. */
  const askTaskInFocus = async (taskId: string, question: string) => {
    if (!result) return "The court has no record of this task yet."
    try {
      const response = await interrogate({ case: trialCase(), task_id: taskId, question_type: "free", question_text: question, previous_result: result, base_revision: result.revision })
      return witnessLine(response)
    } catch (cause) {
      return cause instanceof Error ? cause.message : "The task could not answer right now."
    }
  }
  const openOrder = (id: string) => {
    setOrderTaskId(id)
    setRevision(null)
    requestedRevision.current = null
    setStage("sentence")
  }
  // The judge has its own loading state so the order's buttons never lock; the latest request wins.
  const [reviseBusy, setReviseBusy] = useState(false)
  const [reviseError, setReviseError] = useState("")
  const reviseTicket = useRef(0)
  const askJudge = async (taskId: string, instruction: string) => {
    if (!result) return
    const ticket = ++reviseTicket.current
    setReviseBusy(true)
    setReviseError("")
    try {
      const response = await revise({ case: trialCase(), task_id: taskId, instruction, previous_result: result, base_revision: result.revision })
      if (ticket === reviseTicket.current) setRevision(response)
    } catch (cause) {
      if (ticket === reviseTicket.current) setReviseError(cause instanceof Error ? cause.message : "The judge could not revise this order.")
    } finally {
      if (ticket === reviseTicket.current) setReviseBusy(false)
    }
  }
  useEffect(() => {
    if (!orderTaskId || !result || requestedRevision.current === orderTaskId) return
    // A dismissed task has no plan to detail: the backend answers 422 until it is pardoned or appealed.
    if (result.decisions.find((decision) => decision.task_id === orderTaskId)?.verdict === "DISMISSED") return
    requestedRevision.current = orderTaskId
    void askJudge(orderTaskId, "detail")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderTaskId, result])
  const reviseOrder = async (instruction: string) => {
    if (!orderTaskId) return
    await askJudge(orderTaskId, instruction)
  }

  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }) }, [stage])
  return <div className="trial-app trial-experience">
    <header className="new-court-header"><a className="new-brand" href="#top"><span className="new-brand-mark"><Gavel /></span><span><strong>Tasks on Trial</strong><small>The calendar starts empty. Your tasks must earn their place.</small></span></a><div className="header-recovered"><span>TIME RECOVERED</span><strong>{result?.metrics.minutes_recovered ?? 0}<small> MIN</small></strong></div><span className={`new-source-pill ${source.toLowerCase()}`}><i /> {source}</span></header>
    <main className="new-main" id="top"><nav className="new-stepper" aria-label="Trial stages">{(["docket", "courtroom", "sentence"] as const).map((step, index) => <button key={step} className={`${stage === step ? "active" : ""} ${index < (["docket", "courtroom", "sentence"].indexOf(stage)) ? "complete" : ""}`} onClick={() => { if (step === "docket") setStage("docket"); else if (result) setStage(step) }} disabled={step !== "docket" && !result}><span>{index + 1}</span>{step === "docket" ? "Docket" : step === "courtroom" ? "Courtroom" : "Sentence"}</button>)}</nav>
      {error && <div className="court-error global-error" role="alert"><span>{error}</span>{/restarted/i.test(error) && <button onClick={() => void reconvene()}>Reconvene the court</button>}<button onClick={() => setError("")}>Dismiss</button></div>}
      <AnimatePresence mode="wait">{stage === "docket" && <motion.div key="docket" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}><DocketIntake caseData={caseData} onCase={setCaseData} rawText={docketText} onRawText={setDocketText} onBegin={beginTrial} busy={busy} error={error} setError={setError} /></motion.div>}{stage === "courtroom" && result && <motion.div key="courtroom" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}><Courtroom key={`court-${replayAllKey}`} alliance={alliance} result={result} caseData={caseData} relations={initData?.relations ?? []} startSeated={seenTrialId === result.request_id} onPlayed={() => setSeenTrialId(result.request_id)} onReplayAll={() => { setSeenTrialId(null); setReplay(null); setReplayAllKey((value) => value + 1) }} onSeeDay={() => { setReplay(null); setStage("sentence") }} onCrossExamine={openCross} onPardon={pardonTask} onCallJudge={openOrder} onAppeal={openCross} pardonsUsed={pardonIds.length} busy={busy} replay={replay} /></motion.div>}{stage === "sentence" && result && <motion.div key="sentence" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}><Sentence result={result} caseData={caseData} relations={initData?.relations ?? []} onBack={() => setStage("courtroom")} onCrossExamine={openCross} openOrder={openOrder} onStart={startFocus} pardonIds={pardonIds} activeTaskId={activeTaskId} /></motion.div>}</AnimatePresence>
    </main><footer className="new-footer"><span>THE COURT OF A REASONABLE DAY</span><span>Nothing earns time by default.</span></footer>
    {crossTaskId && currentTask && <CrossExamination task={currentTask} decision={result?.decisions.find((decision) => decision.task_id === crossTaskId)} busy={busy} answer={crossAnswer} onAsk={askCross} onAppeal={appealTask} onClose={() => setCrossTaskId(null)} pact={pactFor(crossTaskId)} onPact={() => void acceptPact(crossTaskId)} />}
    {orderTask && orderDecision && <CourtOrder task={orderTask} decision={orderDecision} slot={orderSlot} caseData={caseData} revision={revision} busy={reviseBusy} error={reviseError} onRevise={reviseOrder} onClose={() => setOrderTaskId(null)} onCrossExamine={() => { setOrderTaskId(null); openCross(orderTask.id) }} onStart={() => { setOrderTaskId(null); startFocus(orderTask.id) }} />}
    <AnimatePresence>{deliberating && <motion.div className="deliberation-overlay" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><JudgeCharacter striking /><strong>The court is deliberating…</strong><span>{deliberating}</span></motion.div>}</AnimatePresence>
    {focusTask && focusDecision && <FocusRoom key={focusTask.id} task={focusTask} decision={focusDecision} archetype={artFor(focusDecision, caseData.tasks)} slot={result?.schedule.find((slot) => slot.task_id === focusTask.id)}
      plan={revision?.task_id === focusTask.id ? revision.action_plan : focusDecision.action_plan}
      firstMove={(revision?.task_id === focusTask.id ? revision.first_move : focusDecision.first_move) ?? "Open the task and take the first small step."}
      doneWhen={(revision?.task_id === focusTask.id ? revision.done_when : focusDecision.done_when) ?? "The agreed scope is complete."}
      judgePresets={[...(JUDGE_PRESETS[artFor(focusDecision, caseData.tasks)] ?? JUDGE_PRESETS.note), "Different first move"]}
      judgeBusy={reviseBusy} judgeError={reviseError} onReconvene={reconvene} onAskTask={(question) => askTaskInFocus(focusTask.id, question)} onAskJudge={(instruction) => void askJudge(focusTask.id, instruction)} onClose={() => setFocusTaskId(null)} />}
  </div>
}
