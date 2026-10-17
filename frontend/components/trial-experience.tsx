"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, Gavel, Send, ShieldCheck, Sparkles, X } from "lucide-react"
import { JudgeCharacter, ProsecutorCharacter, TaskCharacter } from "@/components/task-character-art"
import DocketIntake from "@/components/docket-intake"
import { appeal, interrogate, run, runReplay } from "@/lib/api"
import { pardon, revise, type PardonInput } from "@/lib/api-extra"
import { demoCase } from "@/lib/mocks"
import type { Archetype, Case, Decision, InitResult, InterrogationResult, QuestionType, ReviseResult, Task, TrialResult, Verdict } from "@/lib/types"

const verdictTone: Record<Verdict, string> = { APPROVED: "approved", REDUCED: "reduced", DISMISSED: "dismissed" }

function emptyCase(): Case {
  const data = structuredClone(demoCase)
  return { ...data, constitution: { ...data.constitution, start: "09:00", end: "13:00", fixed_blocks: [] }, tasks: [], rules: { mode: "quick", severity: 0.5, drama: 0.5 } }
}

function archetypeForTask(task: Task): Archetype {
  const text = `${task.title} ${task.category}`.toLowerCase()
  if (/gym|workout|exercise|run|train|health/.test(text)) return "dumbbell"
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
  if (base.source === "live") return base
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



function Courtroom({ result, caseData, relations, onSeeDay, onCrossExamine, onPardon, onCallJudge, onAppeal, pardonsUsed, busy }: {
  result: TrialResult; caseData: Case; relations: InitResult["relations"]; onSeeDay: () => void; onCrossExamine: (id: string) => void; onPardon: (id: string) => void; onCallJudge: (id: string) => void; onAppeal: (id: string) => void; pardonsUsed: number; busy: boolean
}) {
  const reduceMotion = useReducedMotion()
  const [activeIndex, setActiveIndex] = useState(0)
  const [phase, setPhase] = useState<"walking" | "speaking" | "nervous" | "hit" | "verdict" | "sitting">(caseData.rules.mode === "immediate" ? "sitting" : "walking")
  const [menuTask, setMenuTask] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const allSeated = caseData.rules.mode === "immediate" || activeIndex >= result.decisions.length
  const activeDecision = result.decisions[Math.min(activeIndex, result.decisions.length - 1)]
  const activeTask = caseData.tasks.find((task) => task.id === activeDecision?.task_id)
  const relationTasks = useMemo(() => relations.map((relation) => ({ ...relation, a: caseData.tasks.find((task) => task.id === relation.a), b: caseData.tasks.find((task) => task.id === relation.b) })).filter((relation) => relation.a && relation.b), [relations, caseData.tasks])
  const fixedMinutes = caseData.constitution.fixed_blocks.reduce((total, block) => total + Math.max(0, minutes(block.end) - minutes(block.start)), 0)
  const courtBudget = Math.max(0, minutes(caseData.constitution.end) - minutes(caseData.constitution.start) - fixedMinutes)
  useEffect(() => {
    if (caseData.rules.mode === "immediate" || reduceMotion || !result.decisions.length) {
      setPhase("sitting")
      setActiveIndex(result.decisions.length)
      return
    }
    setActiveIndex(0)
    setPhase("walking")
    const phaseTimers = [window.setTimeout(() => setPhase("speaking"), 650), window.setTimeout(() => setPhase("nervous"), 1450), window.setTimeout(() => setPhase("hit"), 2050), window.setTimeout(() => setPhase("verdict"), 2850), window.setTimeout(() => setPhase("sitting"), 3600)]
    const interval = window.setInterval(() => {
      setActiveIndex((index) => {
        const next = index + 1
        if (next >= result.decisions.length) {
          window.clearInterval(interval)
          return result.decisions.length
        }
        setPhase("walking")
        return next
      })
    }, 4500)
    return () => { phaseTimers.forEach(window.clearTimeout); window.clearInterval(interval) }
  }, [caseData.rules.mode, reduceMotion, result.decisions.length])
  useEffect(() => {
    if (allSeated || reduceMotion) return
    const timer = window.setTimeout(() => onSeeDay(), Math.max(1000, (result.decisions.length - activeIndex) * 4500 + 900))
    return () => window.clearTimeout(timer)
  }, [activeIndex, allSeated, onSeeDay, reduceMotion, result.decisions.length])
  useEffect(() => {
    if (phase !== "hit" || reduceMotion) return
    setSeconds((previous) => previous + 1)
  }, [phase, reduceMotion])
  const verdicts = ["APPROVED", "REDUCED", "DISMISSED"] as const
  const byVerdict = (verdict: Verdict) => result.decisions.filter((decision) => decision.verdict === verdict)
  const skip = () => { setPhase("sitting"); setActiveIndex(result.decisions.length); onSeeDay() }
  return <section className={`new-stage courtroom-new ${phase === "hit" && !reduceMotion ? "court-shake" : ""}`}>
    <div className="courtroom-topline"><div><span className="new-eyebrow">THE EVIDENCE IS HEARD</span><h1>The Courtroom</h1><p>Every matter gets its moment. Every minute has a witness.</p></div><button className="skip-verdict" onClick={skip}><ArrowDown /> Skip to the verdict</button></div>
    <div className={`court-scene ${phase === "hit" ? "scene-objection" : ""} ${phase === "verdict" ? "scene-verdict" : ""}`}>
      <div className="scene-curtain" aria-hidden="true" />
      <div className="scene-title"><span>IN THE MATTER OF</span><strong>YOUR DAY</strong></div>
      <div className="judge-bench-scene"><span className="granted-budget-stamp">Budget: {courtBudget} min</span><JudgeCharacter striking={phase === "verdict"} /><div><span>JUDGE&apos;S BENCH</span><strong>{phase === "verdict" ? "Order!" : "The Honourable Day"}</strong></div></div>
      <div className="queue-area"><span className="scene-label">THE QUEUE</span>{result.decisions.map((decision, index) => {
        const task = caseData.tasks.find((item) => item.id === decision.task_id)
        if (!task) return null
        return <motion.div key={task.id} className={`queue-defendant ${index === activeIndex && !allSeated ? "in-spotlight" : ""}`} animate={!reduceMotion && index === activeIndex && !allSeated ? { x: [0, 20, 38], y: [0, -5, 0] } : { x: 0 }} transition={{ duration: 1.1 }}><TaskCharacter archetype={decision.persona.archetype} compact state={index === activeIndex && !allSeated ? phase === "verdict" ? "speaking" : phase : "idle"} prisonerNumber={index + 1} variant="defendant" label={`${decision.effective_title}, queue`} /><span>{decision.effective_title}</span></motion.div>
      })}</div>
      <div className="witness-spot"><span className="scene-label">THE WITNESS STAND</span><div className="witness-rail" />{activeTask && !allSeated && <motion.div className="stand-witness" key={activeTask.id} initial={reduceMotion ? false : { opacity: 0, x: -38, y: 10 }} animate={{ opacity: 1, x: 0, y: 0 }}><TaskCharacter archetype={activeDecision.persona.archetype} state={phase === "verdict" ? "speaking" : phase} prisonerNumber={activeIndex + 1} variant="defendant" label={`${activeTask.title}, ${phase}`} /><span>{activeTask.title}</span>{phase === "speaking" && <div className="defense-bubble"><span>THE DEFENCE</span><p>{activeDecision.defense}</p></div>}{phase === "hit" && <strong className="objection-stamp">OBJECTION!</strong>}{phase === "verdict" && <strong className={`verdict-stamp ${verdictTone[activeDecision.verdict]}`}>{activeDecision.verdict}</strong>}</motion.div>}
        {allSeated && <div className="empty-witness"><span>The room is in order.</span><span>{result.judge_summary}</span></div>}
      </div>
      <div className="prosecutor-area"><ProsecutorCharacter objecting={phase === "hit"} /><span>THE PROSECUTOR</span>{phase === "hit" && <strong>OBJECTION!</strong>}</div>
      <div className="court-floor" />
      <div className="bench-row">{verdicts.map((verdict) => <section key={verdict} className={`court-bench ${verdictTone[verdict]}`}><header><strong>{verdict}</strong><span>{byVerdict(verdict).length} seated</span></header><div className="bench-seats">{byVerdict(verdict).map((decision) => {
        const task = caseData.tasks.find((item) => item.id === decision.task_id)
        if (!task) return null
        const activeMenu = menuTask === task.id
        const pardonAvailable = pardonsUsed < 2 && decision.verdict !== "APPROVED"
        return <div className="seated-character" key={task.id}><TaskCharacter archetype={decision.persona.archetype} state={activeMenu ? "speaking" : "sitting"} prisonerNumber={result.decisions.findIndex((item) => item.task_id === task.id) + 1} variant={decision.verdict === "DISMISSED" ? "defendant" : "on-duty"} label={`Open actions for ${decision.effective_title}`} onClick={() => setMenuTask(activeMenu ? null : task.id)} /><span>{decision.effective_title}</span>{activeMenu && <div className="radial-menu"><button onClick={() => onCrossExamine(task.id)}>Cross-examine</button>{pardonAvailable && <button disabled={busy} onClick={() => { setMenuTask(null); onPardon(task.id) }}>Pardon ({2 - pardonsUsed} left)</button>}<button onClick={() => onCallJudge(task.id)}>Call the judge</button>{decision.verdict === "REDUCED" && <button onClick={() => onAppeal(task.id)}>Appeal</button>}</div>}</div>
      })}</div></section>)}</div>
      <div className="time-recovered"><span className="hourglass-icon">⌛</span><div><small>TIME RECOVERED</small><strong>{result.metrics.minutes_recovered}<em> min</em></strong></div><div className="jar-fill"><i style={{ height: `${Math.min(100, result.metrics.minutes_recovered / 1.8)}%` }} /></div></div>
      {relationTasks.length > 0 && <div className="relations-legend" aria-label="Task relationships">{relationTasks.map((relation) => <span key={`${relation.a?.id}-${relation.b?.id}`} className={`relation-${relation.type}`}>{relation.type === "ally" ? "🤝" : relation.type === "rival" ? "⚡" : "⛓"} {relation.a?.title} ↔ {relation.b?.title}</span>)}</div>}
    </div>
    <div className="courtroom-footer"><span><i /> {allSeated ? "The record is complete" : `${activeIndex + 1} of ${result.decisions.length} matters · ${phase === "hit" ? "OBJECTION!" : phase === "verdict" ? "The judge is deliberating" : phase === "speaking" ? "Defence is heard" : "The court is in session"}`}</span><button onClick={skip}>See my day <ArrowRight /></button></div>
  </section>
}

function Sentence({ result, caseData, relations, onBack, onCrossExamine, openOrder, pardonIds }: {
  result: TrialResult; caseData: Case; relations: InitResult["relations"]; onBack: () => void; onCrossExamine: (id: string) => void; openOrder: (id: string) => void; pardonIds: string[]
}) {
  const scheduled = result.schedule.map((slot) => ({ slot, task: caseData.tasks.find((task) => task.id === slot.task_id), decision: result.decisions.find((decision) => decision.task_id === slot.task_id) })).filter((item) => item.task && item.decision)
  const allocatedMinutes = scheduled.reduce((total, item) => total + minutes(item.slot.end) - minutes(item.slot.start), 0)
  const demoSentence = result.decisions.length === 5 && caseData.tasks.some((task) => /tiktok/i.test(task.title))
  const dayStart = minutes(caseData.constitution.start)
  const dayEnd = minutes(caseData.constitution.end)
  const span = Math.max(1, dayEnd - dayStart)
  const fixed = caseData.constitution.fixed_blocks
  const timelineEntries = [
    ...scheduled.map(({ slot, task, decision }) => ({ start: slot.start, end: slot.end, title: decision?.effective_title ?? task?.title ?? "Task", type: "task", task, decision, buffer: slot.buffer_min })),
    ...fixed.map((block) => ({ start: block.start, end: block.end, title: block.label, type: "fixed", buffer: 0, task: undefined, decision: undefined })),
  ].sort((a, b) => a.start.localeCompare(b.start))
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
    <div className="day-overview"><section className="timeline-new"><div className="overview-head"><div><span className="new-eyebrow">A CLEARER DAY</span><h2>The timeline</h2></div><span>{caseData.constitution.start} — {caseData.constitution.end}</span></div><div className="timeline-axis"><div className="hour-labels">{Array.from({ length: Math.floor(span / 60) + 1 }, (_, index) => dayStart + index * 60).filter((time) => time <= dayEnd).map((time) => <span key={time} style={{ top: `${((time - dayStart) / span) * 100}%` }}>{clock(time)}</span>)}</div><div className="timeline-track-new">{freeGaps.map((gap) => <div key={`free-${gap.start}`} className="free-gap-new" style={{ top: `${((gap.start - dayStart) / span) * 100}%`, height: `${((gap.end - gap.start) / span) * 100}%` }}><span>Free</span></div>)}{timelineEntries.map((entry, index) => <div key={`${entry.type}-${index}`} className={`time-block-new ${entry.type === "fixed" ? "fixed-block-new" : ""}`} style={{ top: `${((minutes(entry.start) - dayStart) / span) * 100}%`, height: `${Math.max(3, ((minutes(entry.end) - minutes(entry.start)) / span) * 100)}%` }}><strong>{entry.title}</strong><small>{entry.start}–{entry.end}</small>{entry.type === "task" && entry.buffer > 0 && <span className="buffer-hatch" style={{ width: `${Math.min(55, (entry.buffer / Math.max(minutes(entry.end) - minutes(entry.start), 1)) * 100)}%` }} title={`${entry.buffer} min travel/setup`} />}</div>)}</div></div><div className="timeline-legend-new"><span><i className="legend-scheduled" />Scheduled</span><span><i className="legend-hatched" />Travel/setup</span><span><i className="legend-free-dashed" />Free</span></div></section>
      <section className="day-tiles"><div className="overview-head"><div><span className="new-eyebrow">YOUR COURT ORDERS</span><h2>Today&apos;s matters</h2></div><span>{scheduled.length} scheduled</span></div><div className="order-tile-list">{result.decisions.map((decision) => {
        const task = caseData.tasks.find((item) => item.id === decision.task_id)
        const slot = result.schedule.find((item) => item.task_id === decision.task_id)
        if (!task) return null
        return <div className="day-task-tile" key={task.id} role="button" tabIndex={0} aria-label={`Open court order for ${decision.effective_title}`} onClick={() => openOrder(task.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openOrder(task.id) } }}><TaskCharacter archetype={decision.persona.archetype} variant="on-duty" compact label={`${task.title}, on duty`} /><span className="tile-main"><strong>{decision.effective_title}</strong><small>{slot ? `${slot.start}–${slot.end}` : "Not scheduled today"}</small><span className={`verdict-badge ${verdictTone[decision.verdict]}`}>{decision.verdict}{pardonIds.includes(task.id) && " · PARDONED"}</span></span>{decision.saved_min > 0 && <span className="tile-saved">SAVED {decision.saved_min} MIN</span>}<ArrowRight /></div>
      })}</div></section>
    </div>
    {relations.length > 0 && <div className="sentence-relations"><span className="new-eyebrow">THE RELATIONSHIPS</span>{relations.map((relation) => <span key={`${relation.a}-${relation.b}`} className={`relation-${relation.type}`}>{relation.type === "ally" ? "🤝" : relation.type === "rival" ? "⚡" : "⛓"} {caseData.tasks.find((task) => task.id === relation.a)?.title} — {relation.reason}</span>)}</div>}
    <button className="sentence-done-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>The day is yours again <Sparkles /></button>
  </section>
}

function CourtOrder({ task, decision, slot, caseData, revision, busy, onRevise, onClose, onCrossExamine }: {
  task: Task; decision: Decision; slot?: TrialResult["schedule"][number]; caseData: Case; revision: ReviseResult | null; busy: boolean; onRevise: (instruction: string) => void; onClose: () => void; onCrossExamine: () => void
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
    onRevise(text)
    setInstruction("")
  }
  const startTime = minutes(slot?.start ?? caseData.constitution.start) + (slot?.buffer_min ?? 0)
  let cursor = startTime
  return <div className="order-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><motion.aside className="court-order-sheet" role="dialog" aria-modal="true" aria-labelledby="order-title" initial={reduceMotion ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }}>
    <div className="order-sheet-header"><button className="order-close" onClick={onClose} aria-label="Close court order"><X /></button><div className="order-hero-character"><TaskCharacter archetype={decision.persona.archetype} variant="on-duty" state="idle" label={`${task.title}, on duty`} /></div><div className="order-heading-copy"><span className="new-eyebrow">COURT ORDER NO. {task.id.toUpperCase()}</span><h2 id="order-title">{decision.effective_title}</h2><p>{slot ? `${slot.start}–${slot.end}` : "Unscheduled · make room when ready"} · {decision.approved_min} min approved</p><span className={`verdict-badge ${verdictTone[decision.verdict]}`}>{decision.verdict}</span>{decision.saved_min > 0 && <strong className="order-saved">SAVED {decision.saved_min} MIN</strong>}</div></div>
    {decision.cut_scope.length > 0 && <div className="not-today"><span>NOT TODAY</span><ul>{decision.cut_scope.map((item) => <li key={item}><s>{item}</s></li>)}</ul></div>}
    <div className="order-sheet-body"><section className="first-move-card"><span>⚡ FIRST MOVE</span><p>{firstMove}</p><button onClick={() => { setFocus(true); setSeconds(60) }}><ArrowRight /> Start</button></section>
      <section className="order-steps"><div className="order-steps-head"><span className="new-eyebrow">THE PLAN</span><h3>One step at a time.</h3></div>{actionPlan.map((step, index) => {
        const begin = cursor
        cursor += step.minutes
        const isActive = activeStep === index
        return <article className={`order-step ${checked[index] ? "step-checked" : ""} ${isActive ? "step-active" : ""}`} key={`${step.step}-${index}`}><div className="order-step-main"><label><input type="checkbox" checked={Boolean(checked[index])} aria-label={`Mark complete: ${step.step}`} onChange={(event) => setChecked((previous) => previous.map((item, itemIndex) => itemIndex === index ? event.target.checked : item))} /><span className="step-checkmark"><Check /></span></label><button className="step-expand" onClick={() => setExpanded(expanded === index ? null : index)} aria-expanded={expanded === index}><span>{clock(begin)}–{clock(begin + step.minutes)}</span><strong>{step.step}</strong><small>{step.minutes} min</small><ChevronDown /></button>{isActive && focus && <div className="focus-timer" aria-live="polite"><svg viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="19"/><circle className="timer-progress" cx="23" cy="23" r="19" style={{ strokeDashoffset: `${119.4 * (1 - seconds / 60)}` }} /></svg><span>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</span></div>}</div>{expanded === index && <div className="step-details">{step.detail && <p>{step.detail}</p>}{step.tip && <p className="step-tip">💡 {step.tip}</p>}{!step.detail && !step.tip && <p>Keep this step small, focused, and easy to finish.</p>}</div>}</article>
      })}</section>
      <div className="done-when-card"><span>DONE WHEN</span><p>{doneWhen}</p></div>
      <div className="mark-done-row">{doneMinutes !== null ? <span className="done-confirmation"><Check /> Done · took {doneMinutes} min</span> : showDuration ? <div className="actual-duration"><label htmlFor="actual-duration">How long did it really take?</label><input id="actual-duration" type="number" min="1" value={actual} onChange={(event) => setActual(event.target.value)} placeholder="Minutes" /><button onClick={() => { if (Number(actual) > 0) { setDoneMinutes(Number(actual)); setShowDuration(false) } }} disabled={Number(actual) <= 0}>Save actual</button></div> : <button className="mark-done-button" onClick={() => setShowDuration(true)}><Check /> Mark done</button>}</div>
      <section className="call-judge-panel"><div className="judge-panel-head"><JudgeCharacter /><div><span className="new-eyebrow">CALL THE JUDGE</span><h3>Need a different order?</h3><p>Ask for a rewrite that fits real life.</p></div></div><div className="judge-presets"><button onClick={() => submitRevision("Make it easier")}>Make it easier</button><button onClick={() => submitRevision("Split it in two")}>Split it in two</button><button onClick={() => submitRevision("I only have my phone")}>I only have my phone</button><button onClick={() => submitRevision("Different first move")}>Different first move</button></div><form className="judge-instruction" onSubmit={(event) => { event.preventDefault(); submitRevision() }}><input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Or tell the judge what needs to change…" /><button disabled={!instruction.trim() || busy} aria-label="Send instruction"><Send /></button></form>{busy && <div className="judge-loading" role="status"><JudgeCharacter striking /><span>The judge is rewriting your order…</span></div>}{revision && !busy && <p className="revision-success"><Check /> A revised order is in.</p>}</section>
      <button className="order-cross-examine" onClick={onCrossExamine}>Cross-examine this task</button>
    </div>
  </motion.aside></div>
}

function CrossExamination({ task, decision, busy, answer, onAsk, onAppeal, onClose }: {
  task: Task; decision?: Decision; busy: boolean; answer: InterrogationResult | null; onAsk: (type: QuestionType) => void; onAppeal: (fact: string) => void; onClose: () => void
}) {
  const [fact, setFact] = useState("")
  return <div className="order-overlay cross-exam-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="cross-exam-card" role="dialog" aria-modal="true" aria-labelledby="cross-exam-title"><button className="order-close" onClick={onClose} aria-label="Close cross-examination"><X /></button><span className="new-eyebrow">THE WITNESS STAND</span><h2 id="cross-exam-title">Cross-examine {decision?.effective_title ?? task.title}</h2><p>One careful question can make room for a more reasonable plea.</p><div className="cross-question-list">{(["purpose", "why_so_long", "why_today"] as QuestionType[]).map((type) => <button key={type} disabled={busy} onClick={() => onAsk(type)}>{type === "purpose" ? "What are you for?" : type === "why_so_long" ? "Why so long?" : "Why today?"}<ArrowRight /></button>)}</div>{answer && <div className="cross-answer"><span>THE WITNESS ANSWERS</span><p>{answer.answer}</p>{answer.proposal && <div className="cross-plea"><strong>Possible plea: {answer.proposal.title} · {answer.proposal.duration_min} min</strong><p>{answer.proposal.first_move}</p><input value={fact} onChange={(event) => setFact(event.target.value)} placeholder="Add a new fact (optional)" /><button onClick={() => onAppeal(fact)}>Accept appeal</button></div>}</div>}</section></div>
}

export default function TrialExperience() {
  const [caseData, setCaseData] = useState<Case>(emptyCase)
  const [docketText, setDocketText] = useState("")
  const [initData, setInitData] = useState<InitResult | null>(null)
  const [result, setResult] = useState<TrialResult | null>(null)
  const [stage, setStage] = useState<"docket" | "courtroom" | "sentence">("docket")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [source, setSource] = useState("Fallback")
  const [pardonIds, setPardonIds] = useState<string[]>([])
  const [crossTaskId, setCrossTaskId] = useState<string | null>(null)
  const [crossAnswer, setCrossAnswer] = useState<InterrogationResult | null>(null)
  const [orderTaskId, setOrderTaskId] = useState<string | null>(null)
  const [revision, setRevision] = useState<ReviseResult | null>(null)
  const requestedRevision = useRef<string | null>(null)
  const currentTask = caseData.tasks.find((task) => task.id === crossTaskId) ?? null
  const orderTask = caseData.tasks.find((task) => task.id === orderTaskId) ?? null
  const orderDecision = result?.decisions.find((decision) => decision.task_id === orderTaskId) ?? null
  const orderSlot = result?.schedule.find((slot) => slot.task_id === orderTaskId)

  const beginTrial = async () => {
    setBusy(true)
    setError("")
    try {
      const currentCase = { ...caseData, rules: { ...caseData.rules } }
      const rawResult = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_USE_MOCK === "true" ? await run(currentCase) : await runReplay()
      const response = updateMockResult(rawResult, currentCase)
      setResult(response)
      setSource(response.source === "live" ? "Live" : response.source === "replay" ? "Replay" : "Fallback")
      setStage("courtroom")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The court could not begin this trial.")
    } finally { setBusy(false) }
  }

  const openCross = (id: string) => { setCrossTaskId(id); setCrossAnswer(null) }
  const askCross = async (type: QuestionType) => {
    if (!result || !currentTask || busy) return
    setBusy(true)
    try {
      const response = await interrogate({ case: caseData, task_id: currentTask.id, question_type: type, question_text: null, previous_result: result, base_revision: result.revision })
      setCrossAnswer(response)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The witness could not be heard.") }
    finally { setBusy(false) }
  }
  const appealTask = async (fact: string) => {
    if (!result || !currentTask) return
    setBusy(true)
    try {
      const updated = await appeal({ case: caseData, task_id: currentTask.id, new_fact: fact.trim() || null, accepted_replacement: crossAnswer?.proposal ?? null, previous_result: result, base_revision: result.revision })
      setResult(updated)
      setCrossTaskId(null)
      setCrossAnswer(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The appeal could not be heard.") }
    finally { setBusy(false) }
  }
  const pardonTask = async (id: string) => {
    if (!result || pardonIds.length >= 2) return
    setBusy(true)
    try {
      const input: PardonInput = { case: caseData, task_id: id, previous_result: result, base_revision: result.revision, pardon: true }
      const updated = await pardon(input)
      setResult(updated)
      setPardonIds((previous) => [...previous, id])
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The pardon could not be granted.") }
    finally { setBusy(false) }
  }
  const openOrder = (id: string) => {
    setOrderTaskId(id)
    setRevision(null)
    requestedRevision.current = null
    setStage("sentence")
  }
  useEffect(() => {
    if (!orderTaskId || !result || requestedRevision.current === orderTaskId) return
    requestedRevision.current = orderTaskId
    setBusy(true)
    revise({ case: caseData, task_id: orderTaskId, instruction: "detail", previous_result: result, base_revision: result.revision }).then(setRevision).catch((cause) => setError(cause instanceof Error ? cause.message : "The judge could not expand this order.")).finally(() => setBusy(false))
  }, [orderTaskId, result, caseData])
  const reviseOrder = async (instruction: string) => {
    if (!orderTaskId || !result) return
    setBusy(true)
    try { setRevision(await revise({ case: caseData, task_id: orderTaskId, instruction, previous_result: result, base_revision: result.revision })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The judge could not revise this order.") }
    finally { setBusy(false) }
  }

  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }) }, [stage])
  return <div className="trial-app trial-experience">
    <header className="new-court-header"><a className="new-brand" href="#top"><span className="new-brand-mark"><Gavel /></span><span><strong>Tasks on Trial</strong><small>The calendar starts empty. Your tasks must earn their place.</small></span></a><div className="header-recovered"><span>TIME RECOVERED</span><strong>{result?.metrics.minutes_recovered ?? 0}<small> MIN</small></strong></div><span className={`new-source-pill ${source.toLowerCase()}`}><i /> {source}</span></header>
    <main className="new-main" id="top"><nav className="new-stepper" aria-label="Trial stages">{(["docket", "courtroom", "sentence"] as const).map((step, index) => <button key={step} className={`${stage === step ? "active" : ""} ${index < (["docket", "courtroom", "sentence"].indexOf(stage)) ? "complete" : ""}`} onClick={() => { if (step === "docket") setStage("docket"); else if (result) setStage(step) }} disabled={step !== "docket" && !result}><span>{index + 1}</span>{step === "docket" ? "Docket" : step === "courtroom" ? "Courtroom" : "Sentence"}</button>)}</nav>
      {error && <div className="court-error global-error" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
      <AnimatePresence mode="wait">{stage === "docket" && <motion.div key="docket" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}><DocketIntake caseData={caseData} onCase={setCaseData} rawText={docketText} onRawText={setDocketText} onBegin={beginTrial} busy={busy} error={error} setError={setError} /></motion.div>}{stage === "courtroom" && result && <motion.div key="courtroom" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}><Courtroom result={result} caseData={caseData} relations={initData?.relations ?? []} onSeeDay={() => setStage("sentence")} onCrossExamine={openCross} onPardon={pardonTask} onCallJudge={openOrder} onAppeal={openCross} pardonsUsed={pardonIds.length} busy={busy} /></motion.div>}{stage === "sentence" && result && <motion.div key="sentence" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}><Sentence result={result} caseData={caseData} relations={initData?.relations ?? []} onBack={() => setStage("courtroom")} onCrossExamine={openCross} openOrder={openOrder} pardonIds={pardonIds} /></motion.div>}</AnimatePresence>
    </main><footer className="new-footer"><span>THE COURT OF A REASONABLE DAY</span><span>Nothing earns time by default.</span></footer>
    {crossTaskId && currentTask && <CrossExamination task={currentTask} decision={result?.decisions.find((decision) => decision.task_id === crossTaskId)} busy={busy} answer={crossAnswer} onAsk={askCross} onAppeal={appealTask} onClose={() => setCrossTaskId(null)} />}
    {orderTask && orderDecision && <CourtOrder task={orderTask} decision={orderDecision} slot={orderSlot} caseData={caseData} revision={revision} busy={busy} onRevise={reviseOrder} onClose={() => setOrderTaskId(null)} onCrossExamine={() => { setOrderTaskId(null); openCross(orderTask.id) }} />}
  </div>
}
