"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { ArrowRight, Check, ChevronDown, Clock3, Gavel, Heart, Plus, Sparkles } from "lucide-react"
import { TaskCharacter } from "@/components/task-character-art"
import { budget, budgetHeadline } from "@/lib/budget"
import { quickCapture } from "@/lib/estimates"
import { applyWitnessAnswer, pickWitnessQuestion } from "@/lib/witness"
import type { Archetype, Case, Category, Task } from "@/lib/types"

const chaoticDay = "Finish pitch slides 90 min due 6pm\nStudy for exam 90 min\nGym 60 min + 20 min travel\nGo for a run 30 min\nReply to emails 30 min\nScroll TikTok 45 min"
const prioritiesForDemo: Category[] = ["work", "learning", "health", "leisure", "money", "family", "other"]
const priorityMarks: Record<Category, string> = { health: "✳", learning: "⌘", work: "▤", money: "£", family: "♡", leisure: "◌", other: "·" }
const trialFormats: { mode: Case["rules"]["mode"]; label: string; hint: string }[] = [
  { mode: "quick", label: "Quick trial", hint: "1 round · defence + objection" },
  { mode: "standard", label: "Standard trial", hint: "2 rounds · rebuttals" },
  { mode: "grand", label: "Grand trial", hint: "3 rounds · full drama" },
  { mode: "immediate", label: "Immediate sentence", hint: "Skip to the verdict" },
]
const quickAddItems: { label: string; line: string }[] = [
  { label: "Study", line: "Study" }, { label: "Gym", line: "Gym" }, { label: "Emails", line: "Reply to emails" },
  { label: "Slides", line: "Finish slides" }, { label: "Meeting", line: "Team meeting 30 min" }, { label: "Report", line: "Write report" },
  { label: "Groceries", line: "Buy groceries" }, { label: "Laundry", line: "Laundry" }, { label: "Cook", line: "Cook dinner 45 min" },
  { label: "Call family", line: "Call mum" }, { label: "Run", line: "Go for a run 30 min" }, { label: "Read", line: "Read a book 30 min" },
  { label: "Errands", line: "Pharmacy errand" }, { label: "Social", line: "Scroll social media" },
]
const durationPresets = [{ label: "XS", minutes: 15 }, { label: "S", minutes: 30 }, { label: "M", minutes: 60 }, { label: "L", minutes: 120 }]

function archetypeForTask(task: Task): Archetype {
  const text = `${task.title} ${task.category}`.toLowerCase()
  if (/gym|workout|exercise|run|train|health/.test(text)) return "dumbbell"
  if (/email|inbox|reply/.test(text)) return "envelope"
  if (/math|study|read|exam|book|learning/.test(text)) return "book"
  if (/presentation|slides|deck|pitch/.test(text)) return "slides"
  if (/instagram|tiktok|phone|social|scroll|leisure/.test(text)) return "phone"
  if (/clean|sweep|chores|laundry/.test(text)) return "broom"
  if (/shop|cart|groceries|money/.test(text)) return "cart"
  if (/meeting|brief|report|work/.test(text)) return "briefcase"
  if (/family|care|heart/.test(text)) return "heart"
  return "note"
}

function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number)
  return (hour || 0) * 60 + (minute || 0)
}

function formatTime(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`
}

function taskLabel(category: Category) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export default function DocketIntake({ caseData, onCase, rawText, onRawText, onBegin, busy, error, setError }: {
  caseData: Case
  onCase: (next: Case) => void
  rawText: string
  onRawText: (text: string) => void
  onBegin: () => void
  busy: boolean
  error: string
  setError: (value: string) => void
}) {
  const [grantedMinutes, setGrantedMinutes] = useState(() => Math.max(0, minutes(caseData.constitution.end) - minutes(caseData.constitution.start) - caseData.constitution.fixed_blocks.reduce((total, block) => total + Math.max(0, minutes(block.end) - minutes(block.start)), 0)))
  const [startAt, setStartAt] = useState(caseData.constitution.start)
  const initializedStart = useRef(false)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [visibleStart, setVisibleStart] = useState(0)
  const [manualDurations, setManualDurations] = useState<string[]>([])
  const [answeredQuestion, setAnsweredQuestion] = useState<string | null>(null)
  const [skippedQuestion, setSkippedQuestion] = useState<string | null>(null)
  const [pulseTask, setPulseTask] = useState<string | null>(null)
  const parsed = useMemo(() => quickCapture(rawText), [rawText])
  const docket = caseData.tasks
  const summary = budget(docket, grantedMinutes)
  const headline = budgetHeadline(summary)
  const question = pickWitnessQuestion(docket)
  const witnessTask = question ? docket.find((task) => task.id === question.task_id) ?? null : null
  const fixedMinutes = caseData.constitution.fixed_blocks.reduce((total, block) => total + Math.max(0, minutes(block.end) - minutes(block.start)), 0)
  const scheduleMinutes = grantedMinutes + fixedMinutes

  useEffect(() => {
    if (initializedStart.current) return
    initializedStart.current = true
    const isDefaultWindow = caseData.constitution.start === "09:00" && caseData.constitution.end === "13:00" && docket.length === 0
    const now = new Date()
    const start = isDefaultWindow ? formatTime(now.getHours() * 60 + now.getMinutes()) : caseData.constitution.start
    const end = formatTime(minutes(start) + grantedMinutes + fixedMinutes)
    setStartAt(start)
    onCase({ ...caseData, constitution: { ...caseData.constitution, start, end } })
  }, [caseData, fixedMinutes, grantedMinutes, onCase])

  const syncWindow = (nextStart = startAt, nextBudget = grantedMinutes, fixed = caseData.constitution.fixed_blocks) => {
    const fixedTotal = fixed.reduce((total, block) => total + Math.max(0, minutes(block.end) - minutes(block.start)), 0)
    onCase({ ...caseData, constitution: { ...caseData.constitution, start: nextStart, end: formatTime(minutes(nextStart) + nextBudget + fixedTotal), fixed_blocks: fixed } })
  }
  const setAvailableMinutes = (next: number) => {
    const safe = Math.min(960, Math.max(0, next))
    setGrantedMinutes(safe)
    syncWindow(startAt, safe)
  }
  const onTextChange = (text: string) => {
    const result = quickCapture(text)
    onRawText(text)
    setManualDurations([])
    setVisibleStart(0)
    onCase({ ...caseData, tasks: result.tasks, constitution: { ...caseData.constitution, start: startAt, end: formatTime(minutes(startAt) + grantedMinutes + fixedMinutes) } })
  }
  const appendQuickAdd = (item: string) => onTextChange(`${rawText.trimEnd()}${rawText.trim() ? "\n" : ""}${item}`)
  const setPriorityOrder = (next: Category[]) => onCase({ ...caseData, constitution: { ...caseData.constitution, priorities: next } })
  const movePriority = (index: number, direction: -1 | 1) => {
    const next = [...caseData.constitution.priorities]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setPriorityOrder(next)
  }
  const updateTask = (taskId: string, patch: Partial<Task>) => onCase({ ...caseData, tasks: docket.map((task) => task.id === taskId ? { ...task, ...patch } : task) })
  const setDuration = (task: Task, duration: number) => {
    updateTask(task.id, { duration_min: Math.max(5, duration), minimum_min: Math.min(task.minimum_min, Math.max(5, duration)) })
    setManualDurations((current) => current.includes(task.id) ? current : [...current, task.id])
  }
  const loadDemo = () => {
    const demo = quickCapture(chaoticDay)
    const start = "12:00"
    const priorities = [...prioritiesForDemo]
    onRawText(chaoticDay)
    setGrantedMinutes(240)
    setStartAt(start)
    setManualDurations([])
    setVisibleStart(0)
    setAnsweredQuestion(null)
    setSkippedQuestion(null)
    onCase({
      ...caseData,
      tasks: demo.tasks,
      constitution: { ...caseData.constitution, start, end: "16:00", fixed_blocks: [], priorities },
    })
  }
  const applyAnswer = (option: NonNullable<typeof question>["options"][number]) => {
    const task = docket.find((item) => item.id === question?.task_id)
    if (!task || !question) return
    onCase({ ...caseData, tasks: docket.map((item) => item.id === task.id ? applyWitnessAnswer(item, option) : item) })
    setAnsweredQuestion(question.id)
    setPulseTask(task.id)
    window.setTimeout(() => setPulseTask(null), 850)
  }
  const addCommitment = () => {
    const start = formatTime(minutes(startAt) + Math.min(120, grantedMinutes / 2))
    const end = formatTime(minutes(start) + 30)
    syncWindow(startAt, grantedMinutes, [...caseData.constitution.fixed_blocks, { start, end, label: "Meeting" }])
  }
  const changeCommitment = (index: number, patch: Partial<Case["constitution"]["fixed_blocks"][number]>) => {
    const fixed = caseData.constitution.fixed_blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block)
    syncWindow(startAt, grantedMinutes, fixed)
  }
  const currentBatch = docket.slice(visibleStart, visibleStart + 6)
  const waiting = Math.max(0, docket.length - 6)
  const nextBatchStart = visibleStart === 0 ? 6 : visibleStart + 6
  const requestedScale = Math.max(1, summary.requestedMinutes, summary.grantedMinutes)
  const grantedWidth = Math.min(100, (summary.grantedMinutes / requestedScale) * 100)
  const overflowWidth = Math.max(0, Math.min(100 - grantedWidth, (summary.overBudgetMinutes / requestedScale) * 100))
  const answered = answeredQuestion === question?.id

  return <section className="new-stage docket-new budget-docket">
    <header className="new-stage-heading budget-docket-heading"><div><span className="new-eyebrow">THE COURT OF A REASONABLE DAY · SESSION 01</span><h1>Your time.<br /><em>Their burden of proof.</em></h1><p>Add what wants your attention. The court decides what deserves it.</p></div><div className="docket-seal"><Gavel /><span>THE<br />DOCKET</span></div></header>

    <section className="budget-first-panel docket-paper" aria-labelledby="available-time-title">
      <div className="budget-first-top"><div><span className="new-eyebrow">FIRST, SET THE LIMIT</span><h2 id="available-time-title">How much time are you willing to give today?</h2></div><label className="available-time-label">Available time<span>{Math.floor(grantedMinutes / 60)}h{grantedMinutes % 60 ? ` ${grantedMinutes % 60}m` : ""}</span></label></div>
      <div className="budget-controls-row"><div className="budget-presets" role="group" aria-label="Available time presets">{[120, 240, 360, 480].map((value) => <button key={value} className={`budget-preset ${grantedMinutes === value ? "selected" : ""}`} aria-pressed={grantedMinutes === value} onClick={() => setAvailableMinutes(value)}>{value / 60}h{value === 240 && <small>Suggested</small>}</button>)}</div><div className="budget-stepper"><button aria-label="Reduce available time by 30 minutes" onClick={() => setAvailableMinutes(grantedMinutes - 30)}>−</button><span>30 min steps</span><button aria-label="Add 30 minutes of available time" onClick={() => setAvailableMinutes(grantedMinutes + 30)}>+</button></div></div>
      <p className="budget-caption">Excludes meetings and other fixed commitments.</p>
      <details className="optional-budget-detail"><summary>+ Add commitment</summary><div className="commitment-list">{caseData.constitution.fixed_blocks.map((block, index) => <div className="commitment-row" key={`${block.label}-${index}`}><label>Commitment<input aria-label="Commitment" value={block.label} onChange={(event) => changeCommitment(index, { label: event.target.value })} /></label><label>Starts<input aria-label="Commitment start" type="time" value={block.start} onChange={(event) => changeCommitment(index, { start: event.target.value })} /></label><label>Ends<input aria-label="Commitment end" type="time" value={block.end} onChange={(event) => changeCommitment(index, { end: event.target.value })} /></label><button className="remove-commitment" aria-label={`Remove ${block.label}`} onClick={() => syncWindow(startAt, grantedMinutes, caseData.constitution.fixed_blocks.filter((_, blockIndex) => blockIndex !== index))}>Remove</button></div>)}<button className="quiet-add-commitment" onClick={addCommitment}><Plus /> Add a fixed block</button></div></details>
      <details className="optional-budget-detail"><summary>Schedule from: now</summary><div className="schedule-start-row"><label>Start time<input type="time" aria-label="Schedule from" value={startAt} onChange={(event) => { setStartAt(event.target.value); syncWindow(event.target.value, grantedMinutes) }} /></label><button onClick={() => { const now = new Date(); const start = formatTime(now.getHours() * 60 + now.getMinutes()); setStartAt(start); syncWindow(start, grantedMinutes) }}>Use now</button><span>The court will use this as the beginning of your available window.</span></div></details>

      <div className="live-budget-meter" aria-live="polite">
        {summary.impossible && <div className="impossible-budget-banner" role="alert">Impossible as filed. The mandatory tasks alone exceed the time you have granted.</div>}
        <div className="budget-meter-copy"><h3>{headline.title}</h3><p className={summary.overBudgetMinutes > 0 ? "over-budget-copy" : "within-budget-copy"}>{headline.line}</p><span>{headline.defendants}</span></div>
        <div className={`budget-meter-track ${summary.overBudgetMinutes > 0 ? "is-over-budget" : ""}`} role="img" aria-label={`${summary.requestedMinutes} requested minutes against ${summary.grantedMinutes} available minutes`}><motion.div className="budget-meter-granted" animate={{ width: `${grantedWidth}%` }} transition={{ duration: 0.3, ease: "easeOut" }} /><motion.div className="budget-meter-overflow" animate={{ left: `${grantedWidth}%`, width: `${overflowWidth}%` }} transition={{ duration: 0.3, ease: "easeOut" }} /></div>
        <div className="budget-meter-legend"><span><i /> {summary.grantedMinutes} min granted</span><span><i /> {summary.requestedMinutes} min requested</span>{summary.overBudgetMinutes > 0 && <strong>{summary.overBudgetMinutes} min over</strong>}</div>
      </div>
    </section>

    <section className="quick-capture docket-paper budget-capture"><div className="new-section-head"><span className="new-section-icon"><Sparkles /></span><div><span>THE DOCKET</span><h2>{docket.length ? headline.defendants : "File today’s defendants"}</h2></div><span className="capture-note">ONE TASK PER LINE · PASTE FRIENDLY</span></div>
      <label className="sr-only" htmlFor="task-capture">File your tasks</label><textarea id="task-capture" value={rawText} onChange={(event) => onTextChange(event.target.value)} placeholder="Finish pitch slides by 6pm / Gym 60 min / Reply to emails / Study for exam / Scroll TikTok 45 min" rows={5} aria-label="File your tasks, one task per line" />
      <div className="quick-add-row"><span>QUICK-ADD</span>{quickAddItems.map((item) => <button key={item.label} onClick={() => appendQuickAdd(item.line)}>+ {item.label}</button>)}<button className="chaotic-day-button" onClick={loadDemo}>Try a chaotic day</button></div>
      <div className="docket-task-list" aria-live="polite">{currentBatch.map((task, index) => {
        const estimated = parsed.estimated[task.id] ?? []
        const durationIsEstimated = estimated.includes("duration_min") && !manualDurations.includes(task.id)
        const travelIsEstimated = estimated.includes("buffer_min")
        const isOpen = openTask === task.id
        const absoluteIndex = visibleStart + index
        return <article key={task.id} className={`budget-task-row ${pulseTask === task.id ? "witness-task-pulse" : ""}`}>
          <TaskCharacter archetype={archetypeForTask(task)} compact variant="defendant" prisonerNumber={absoluteIndex + 1} label={`${task.title}, defendant number ${absoluteIndex + 1}`} />
          <div className="budget-task-main"><strong>{task.title}</strong><span>{taskLabel(task.category)}</span></div>
          <div className="budget-task-chips">
            <button className={`budget-task-chip duration-chip ${durationIsEstimated ? "estimated-value" : ""}`} aria-expanded={isOpen} onClick={() => setOpenTask(isOpen ? null : task.id)}><Clock3 /> {task.duration_min}m {durationIsEstimated && <small>est.</small>}</button>
            {task.buffer_min > 0 && <span className={`budget-task-chip ${travelIsEstimated ? "estimated-value" : ""}`}>+{task.buffer_min}m travel{travelIsEstimated && <small>est.</small>}</span>}
            {task.deadline && <span className="budget-task-chip"><Clock3 /> {task.deadline}<span className="sr-only"> Deadline</span></span>}
            {task.mandatory && <span className="budget-task-chip mandatory-chip">🔒 <span className="sr-only">Mandatory</span></span>}
            <span className="budget-task-chip facts-chip">📎 {task.facts.length} facts</span>
          </div>
          <button className="task-edit-button" aria-label={`Edit ${task.title}`} aria-expanded={isOpen} onClick={() => setOpenTask(isOpen ? null : task.id)}>Edit <ChevronDown /></button>
          {isOpen && <motion.div className="budget-task-editor" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
            <div className="duration-presets" role="group" aria-label={`Duration presets for ${task.title}`}>{durationPresets.map((preset) => <button key={preset.label} onClick={() => setDuration(task, preset.minutes)}>{preset.label}<small>{preset.minutes}m</small></button>)}</div>
            <div className="duration-stepper"><span>Duration</span><button aria-label={`Decrease ${task.title} by 5 minutes`} onClick={() => setDuration(task, task.duration_min - 5)}>−</button><label className="sr-only" htmlFor={`duration-${task.id}`}>Edit</label><input id={`duration-${task.id}`} type="number" min={5} step={5} value={task.duration_min} onChange={(event) => setDuration(task, Number(event.target.value) || 5)} /><span>min</span><button aria-label={`Increase ${task.title} by 5 minutes`} onClick={() => setDuration(task, task.duration_min + 5)}>+</button></div>
            <label className="task-deadline-edit">Deadline<input type="time" value={task.deadline ?? ""} onChange={(event) => updateTask(task.id, { deadline: event.target.value || null })} /></label>
            <label className="task-travel-edit">Travel / setup<input type="number" min={0} step={5} value={task.buffer_min} onChange={(event) => updateTask(task.id, { buffer_min: Math.max(0, Number(event.target.value) || 0) })} /></label>
            <label className="task-mandatory-edit"><input type="checkbox" checked={task.mandatory} onChange={(event) => updateTask(task.id, { mandatory: event.target.checked, allow_reduction: !event.target.checked })} /> Mandatory</label>
          </motion.div>}
        </article>
      })}</div>
      {waiting > 0 && <button className="waiting-docket-button" onClick={() => setVisibleStart(nextBatchStart < docket.length ? nextBatchStart : 0)}>{visibleStart === 0 ? `${waiting} waiting outside the docket · Swap in` : nextBatchStart < docket.length ? `${docket.length - nextBatchStart} waiting outside the docket · Swap in` : "Back to the first six"}<ArrowRight /></button>}
    </section>

    <section className="priorities-block docket-paper budget-priorities"><div><Heart /><strong>What matters most</strong><small>Order the principles the judge should consider.</small></div><ol>{caseData.constitution.priorities.map((category, index) => <li key={category}><span className={`priority-gem ${category}`}>{priorityMarks[category]}</span><b>{category}</b><button aria-label={`Move ${category} up`} disabled={index === 0} onClick={() => movePriority(index, -1)}>↑</button><button aria-label={`Move ${category} down`} disabled={index === caseData.constitution.priorities.length - 1} onClick={() => movePriority(index, 1)}>↓</button></li>)}</ol></section>

    {question && skippedQuestion !== question.id && <section className="single-witness-section"><div className="single-witness-icon" aria-hidden="true">⚖</div><div className="single-witness-content"><span className="new-eyebrow">ONE QUESTION FROM THE BENCH</span>{witnessTask && <div className="witness-about"><TaskCharacter archetype={archetypeForTask(witnessTask)} compact variant="defendant" prisonerNumber={docket.findIndex((task) => task.id === witnessTask.id) + 1} label={`Question about ${witnessTask.title}`} /><span>About defendant #{String(docket.findIndex((task) => task.id === witnessTask.id) + 1).padStart(2, "0")}<strong>{witnessTask.title}</strong></span></div>}<h2>{question.question}</h2><div className="single-witness-options">{question.options.map((option) => <button key={option.label} disabled={answered} onClick={() => applyAnswer(option)}>{option.label}<ArrowRight /></button>)}{!answered && <button className="skip-witness-button" onClick={() => setSkippedQuestion(question.id)}>Skip question <ArrowRight /></button>}</div>{answered && <span className="witness-answer-confirmation"><Check /> The fact is in the record.</span>}</div></section>}

    {error && <div className="court-error" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    <div className="trial-format" role="group" aria-label="Trial format"><span className="new-eyebrow">TRIAL FORMAT</span>{trialFormats.map((format) => <button key={format.mode} className={caseData.rules.mode === format.mode ? "active" : ""} aria-pressed={caseData.rules.mode === format.mode} onClick={() => onCase({ ...caseData, rules: { ...caseData.rules, mode: format.mode } })}><strong>{format.label}</strong><small>{format.hint}</small></button>)}</div>
    <div className="convene-row"><span>{docket.length ? headline.defendants : "Add a task to open the docket."}</span><button className="begin-trial-button" disabled={busy || docket.length === 0} onClick={() => { setError(""); onBegin() }}><Gavel /> {busy ? "The court is convening…" : "Convene the court"}<ArrowRight /></button></div>
    <span className="sr-only">The available scheduling window is {scheduleMinutes} minutes including commitments.</span>
  </section>
}
