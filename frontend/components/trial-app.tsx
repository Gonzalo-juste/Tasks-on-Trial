"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion"
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronUp, Clock3, Gavel, Heart, Plus, Printer, RotateCcw, Scissors, Send, ShieldCheck, Sparkles, X } from "lucide-react"
import { AnimatedMinutes, Judge, Prosecutor, RecoveredJar, TaskCharacter, TypedLine } from "@/components/courtroom-motion"
import { Button } from "@/components/ui/button"
import { appeal, appealReplay, interrogate, interrogateReplay, run, runReplay } from "@/lib/api"
import { categoryLabel, demoCase } from "@/lib/mocks"
import type { Case, Category, Decision, InterrogationResult, QuestionType, Task, TrialResult, Verdict } from "@/lib/types"

const allCategories: Category[] = ["health", "learning", "work", "money", "family", "leisure"]
const questions: { type: QuestionType; label: string }[] = [
  { type: "purpose", label: "What are you for?" },
  { type: "why_so_long", label: "Why so long?" },
  { type: "why_today", label: "Why today?" },
  { type: "who_needs", label: "Who needs you?" },
  { type: "minimal", label: "What&apos;s your smallest version?" },
]
const verdictMeta: Record<Verdict, { title: string; icon: typeof Check; tone: string; eyebrow: string }> = {
  APPROVED: { title: "Approved", icon: Check, tone: "approved", eyebrow: "The court allows it" },
  REDUCED: { title: "Reduced", icon: Scissors, tone: "reduced", eyebrow: "A smaller sentence" },
  DISMISSED: { title: "Dismissed", icon: X, tone: "dismissed", eyebrow: "Not today" },
}

function cloneDemo(): Case {
  return structuredClone(demoCase)
}

function useTrialActions() {
  const [source, setSource] = useState<TrialResult["source"]>("fallback")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [caseData, setCaseData] = useState<Case>(cloneDemo)
  const [result, setResult] = useState<TrialResult | null>(null)
  const [stage, setStage] = useState<"docket" | "courtroom" | "sentence">("docket")
  const latestRevision = useRef(0)
  const useReplayMode = useRef(false)

  const execute = async (action: () => Promise<TrialResult>, nextStage: "courtroom" | "sentence") => {
    setBusy(true)
    setError("")
    try {
      const response = await action()
      if (response.revision < latestRevision.current) return
      latestRevision.current = response.revision
      setResult(response)
      setSource(response.source)
      setStage(nextStage)
      return response
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The court is unavailable. Please retry or use replay.")
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const startTrial = () => execute(() => useReplayMode.current ? runReplay() : run(caseData), "courtroom")
  const useReplay = () => {
    useReplayMode.current = true
    return execute(runReplay, "courtroom")
  }
  const runInterrogation = async (input: Parameters<typeof interrogate>[0]) => {
    setBusy(true)
    setError("")
    try {
      const response = useReplayMode.current ? await interrogateReplay(input) : await interrogate(input)
      if (response.base_revision < latestRevision.current) return null
      return response
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The answer could not be heard. Please try again.")
      return null
    } finally {
      setBusy(false)
    }
  }
  const acceptAppeal = (input: Parameters<typeof appeal>[0]) => execute(() => useReplayMode.current ? appealReplay(input) : appeal(input), "sentence")
  const updateCase = (update: (previous: Case) => Case) => setCaseData(update)
  const reset = () => {
    setCaseData(cloneDemo())
    setResult(null)
    setStage("docket")
    setError("")
    setSource("fallback")
    setBusy(false)
    latestRevision.current = 0
    useReplayMode.current = false
  }
  return { caseData, updateCase, result, stage, setStage, source, busy, error, setError, startTrial, useReplay, runInterrogation, acceptAppeal, reset }
}

export default function TrialApp() {
  const court = useTrialActions()
  useEffect(() => {
    if (court.stage !== "docket") window.scrollTo({ top: 0, behavior: "auto" })
  }, [court.stage])
  const [credibility, setCredibility] = useState<Record<string, number>>({})
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({})
  const [sheetTaskId, setSheetTaskId] = useState<string | null>(null)
  const [answer, setAnswer] = useState<InterrogationResult | null>(null)
  const [appealFact, setAppealFact] = useState("")
  const [ratings, setRatings] = useState<Record<string, InterrogationResult["rating"]>>({})
  const [skipSentenceMotion, setSkipSentenceMotion] = useState(false)
  const currentTask = court.caseData.tasks.find((task) => task.id === sheetTaskId) ?? null
  const minutesRecovered = court.result?.metrics.minutes_recovered ?? 0
  const freeCapacity = court.result?.metrics.free_capacity_min ?? 195
  const sourceText = court.source === "live" ? "Live · Nebius" : court.source === "replay" ? "Replay" : "Fallback"

  const openCrossExamination = (taskId: string) => {
    setSheetTaskId(taskId)
    setAnswer(null)
    setAppealFact("")
  }

  const askQuestion = async (type: QuestionType, freeText?: string) => {
    if (!court.result || !currentTask || court.busy) return
    if ((questionCounts[currentTask.id] ?? 0) >= 3) return
    const response = await court.runInterrogation({
      case: court.caseData,
      task_id: currentTask.id,
      question_type: type,
      question_text: freeText ?? null,
      previous_result: court.result,
      base_revision: court.result.revision,
    })
    if (!response) return
    setAnswer(response)
    setRatings((previous) => ({ ...previous, [currentTask.id]: response.rating }))
    setQuestionCounts((previous) => ({ ...previous, [currentTask.id]: (previous[currentTask.id] ?? 0) + 1 }))
    setCredibility((previous) => ({
      ...previous,
      [currentTask.id]: Math.max(0, Math.min(100, (previous[currentTask.id] ?? 50) + Math.round(response.credibility_delta * 100))),
    }))
  }

  const acceptPlea = async () => {
    if (!court.result || !currentTask || court.result.appeals_used >= 1) return
    const updated = await court.acceptAppeal({
      case: court.caseData,
      task_id: currentTask.id,
      new_fact: appealFact.trim() || null,
      accepted_replacement: answer?.proposal ?? null,
      previous_result: court.result,
      base_revision: court.result.revision,
    })
    if (updated) {
      setSkipSentenceMotion(false)
      setSheetTaskId(null)
      setAnswer(null)
      setCredibility((previous) => ({ ...previous, [currentTask.id]: Math.min(100, (previous[currentTask.id] ?? 50) + 20) }))
    }
  }

  const startTrial = () => { setSkipSentenceMotion(false); return court.startTrial() }
  const startReplay = () => { setSkipSentenceMotion(false); return court.useReplay() }
  const showVerdict = (skipMotion: boolean) => { setSkipSentenceMotion(skipMotion); court.setStage("sentence") }

  const loadDemo = () => {
    court.reset()
    setCredibility({})
    setQuestionCounts({})
    setRatings({})
    setSkipSentenceMotion(false)
  }

  return (
    <div className="trial-app min-h-screen">
      <header className="court-header">
        <div className="header-inner">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true"><Gavel /></div>
            <div>
              <p className="brand-name">Tasks on Trial</p>
              <p className="brand-tagline">The calendar starts empty. Your tasks must earn their place.</p>
            </div>
          </div>
          <div className="header-score" aria-live="polite">
            <span className="score-label"><RecoveredJar value={minutesRecovered} /> Minutes recovered</span>
            <div className="score-number"><AnimatedMinutes value={minutesRecovered} /><small>min</small></div>
            <span className="capacity-note">Free capacity <strong>{freeCapacity} min</strong></span>
          </div>
          <div className="source-pill" aria-label={`Data source: ${sourceText}`}><span className={`source-dot ${court.source}`} />{sourceText}<ChevronDown aria-hidden="true" /></div>
        </div>
        <div className="header-rule" aria-hidden="true"><span /></div>
      </header>

      <main className="main-content">
        <nav className="stepper" aria-label="Trial stages">
          {(["docket", "courtroom", "sentence"] as const).map((step, index) => {
            const active = court.stage === step
            const completed = (court.stage === "courtroom" && index === 0) || (court.stage === "sentence" && index < 2)
            return <button key={step} className={`step-item ${active ? "active" : ""} ${completed ? "completed" : ""}`} onClick={() => {
              if (step === "docket") court.setStage("docket")
              else if (step === "courtroom" && court.result) court.setStage("courtroom")
              else if (step === "sentence" && court.result) showVerdict(true)
            }} aria-current={active ? "step" : undefined} disabled={court.busy}>
              <span className="step-number">{completed ? <Check aria-hidden="true" /> : `0${index + 1}`}</span><span>{step === "docket" ? "Docket" : step === "courtroom" ? "Courtroom" : "Sentence"}</span>
            </button>
          })}
        </nav>

        {court.error && <div className="error-banner" role="alert"><AlertCircle aria-hidden="true" /><div><strong>The court has paused.</strong><span>{court.error}</span></div><Button variant="outline" size="sm" onClick={() => court.setError("")}>Dismiss</Button></div>}
        {court.busy && <div className="deliberating" role="status"><span className="deliberating-seal"><Gavel /></span><span>The court is deliberating...</span><span className="loading-track"><i /></span></div>}

        {court.stage === "docket" && <DocketStage caseData={court.caseData} updateCase={court.updateCase} busy={court.busy} onLoadDemo={loadDemo} onStart={startTrial} onReplay={startReplay} error={court.error} />}
        <AnimatePresence mode="wait" initial={false}>
          {court.stage === "courtroom" && court.result && <CourtroomStage key="courtroom" result={court.result} caseData={court.caseData} onVerdict={() => showVerdict(true)} onAutoVerdict={() => showVerdict(false)} onCrossExamine={openCrossExamination} witnessTaskId={sheetTaskId} ratings={ratings} busy={court.busy} />}
          {court.stage === "sentence" && court.result && <SentenceStage
            key="sentence"
            result={court.result}
            caseData={court.caseData}
            credibility={credibility}
            ratings={ratings}
            skipAnimations={skipSentenceMotion}
            selectedTaskId={sheetTaskId}
            onCrossExamine={openCrossExamination}
            onBack={() => court.setStage("courtroom")}
            busy={court.busy}
          />}
        </AnimatePresence>
      </main>

      {sheetTaskId && currentTask && court.result && <CrossExaminationSheet
        task={currentTask}
        decision={court.result.decisions.find((decision) => decision.task_id === currentTask.id) ?? null}
        answer={answer}
        count={questionCounts[currentTask.id] ?? 0}
        credibility={credibility[currentTask.id] ?? 50}
        busy={court.busy}
        appealUsed={court.result.appeals_used >= 1}
        appealFact={appealFact}
        error={court.error}
        onClose={() => { setSheetTaskId(null); court.setError("") }}
        onAsk={askQuestion}
        onFact={setAppealFact}
        onAccept={acceptPlea}
        onDismissError={() => court.setError("")}
      />}
      <footer className="page-footer"><span>THE COURT OF A REASONABLE DAY</span><span>Nothing earns time by default.</span></footer>
    </div>
  )
}

function DocketStage({ caseData, updateCase, busy, onLoadDemo, onStart, onReplay, error }: {
  caseData: Case; updateCase: (update: (previous: Case) => Case) => void; busy: boolean; onLoadDemo: () => void; onStart: () => void; onReplay: () => void; error: string
}) {
  const totalRequested = caseData.tasks.reduce((total, task) => total + task.duration_min, 0)
  const updateTask = (id: string, patch: Partial<Task>) => updateCase((previous) => ({ ...previous, tasks: previous.tasks.map((task) => task.id === id ? { ...task, ...patch } : task) }))
  const addTask = () => updateCase((previous) => previous.tasks.length >= 6 ? previous : ({ ...previous, tasks: [...previous.tasks, { id: `task-${Date.now()}`, title: "New task", duration_min: 30, buffer_min: 0, minimum_min: 15, mandatory: false, deadline: null, depends_on: [], category: "work", allow_reduction: true, facts: [] }] }))
  const removeTask = (id: string) => updateCase((previous) => ({ ...previous, tasks: previous.tasks.filter((task) => task.id !== id).map((task) => ({ ...task, depends_on: task.depends_on.filter((dependency) => dependency !== id) })) }))
  const setConstitution = (patch: Partial<Case["constitution"]>) => updateCase((previous) => ({ ...previous, constitution: { ...previous.constitution, ...patch } }))
  const movePriority = (index: number, direction: -1 | 1) => updateCase((previous) => {
    const next = [...previous.constitution.priorities]
    const target = index + direction
    if (target < 0 || target >= next.length) return previous
    ;[next[index], next[target]] = [next[target], next[index]]
    return { ...previous, constitution: { ...previous.constitution, priorities: next } }
  })
  const addFixedBlock = () => setConstitution({ fixed_blocks: [...caseData.constitution.fixed_blocks, { start: "12:00", end: "13:00", label: "Protected time" }] })

  return <section className="stage-shell docket-stage">
    <div className="stage-heading">
      <div><p className="eyebrow"><span className="eyebrow-line" /> Before the court</p><h1>The Docket</h1><p className="stage-intro">A clear day is a generous day. Put each request on the record.</p></div>
      <div className="docket-stamp"><span>Today&apos;s</span><strong>Cause list</strong><span className="stamp-rule" />{caseData.tasks.length} matters submitted</div>
    </div>

    <div className="docket-layout">
      <div className="docket-main">
        <section className="paper-panel day-panel">
          <div className="panel-heading"><span className="panel-icon"><Clock3 /></span><div><h2>Set the bounds of the day</h2><p>Fixed commitments are respected before anything else.</p></div><span className="section-index">01</span></div>
          <div className="day-time-fields">
            <label>Day begins<input type="time" value={caseData.constitution.start} disabled={busy} onChange={(event) => setConstitution({ start: event.target.value })} /></label>
            <span className="time-divider" aria-hidden="true">to</span>
            <label>Day ends<input type="time" value={caseData.constitution.end} disabled={busy} onChange={(event) => setConstitution({ end: event.target.value })} /></label>
          </div>
          <div className="subsection-heading"><span>Fixed blocks</span><span>Keep these protected</span></div>
          <div className="fixed-block-list">
            {caseData.constitution.fixed_blocks.map((block, index) => <div className="fixed-block-row" key={`${index}-${block.label}`}>
              <input aria-label="Block start time" type="time" value={block.start} disabled={busy} onChange={(event) => setConstitution({ fixed_blocks: caseData.constitution.fixed_blocks.map((item, itemIndex) => itemIndex === index ? { ...item, start: event.target.value } : item) })} />
              <span className="muted-dash">—</span>
              <input aria-label="Block end time" type="time" value={block.end} disabled={busy} onChange={(event) => setConstitution({ fixed_blocks: caseData.constitution.fixed_blocks.map((item, itemIndex) => itemIndex === index ? { ...item, end: event.target.value } : item) })} />
              <input className="block-label-input" aria-label="Block label" value={block.label} disabled={busy} onChange={(event) => setConstitution({ fixed_blocks: caseData.constitution.fixed_blocks.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} />
              <button className="icon-button subtle" aria-label={`Remove ${block.label}`} disabled={busy} onClick={() => setConstitution({ fixed_blocks: caseData.constitution.fixed_blocks.filter((_, itemIndex) => itemIndex !== index) })}><X /></button>
            </div>)}
          </div>
          <button className="text-button" onClick={addFixedBlock} disabled={busy}><Plus /> Add a fixed block</button>
          <EmptyDayPreview caseData={caseData} />
        </section>

        <section className="paper-panel priorities-panel">
          <div className="panel-heading"><span className="panel-icon"><Heart /></span><div><h2>What matters most?</h2><p>Order the principles the judge should consider.</p></div><span className="section-index">02</span></div>
          <ol className="priority-list">{caseData.constitution.priorities.map((category, index) => <li key={category}><span className={`priority-gem ${category}`}><PriorityMark category={category} /></span><span className="priority-name">{categoryLabel(category)}</span><span className="priority-position">{index + 1}</span><button aria-label={`Move ${categoryLabel(category)} up`} className="icon-button" disabled={busy || index === 0} onClick={() => movePriority(index, -1)}><ChevronUp /></button><button aria-label={`Move ${categoryLabel(category)} down`} className="icon-button" disabled={busy || index === caseData.constitution.priorities.length - 1} onClick={() => movePriority(index, 1)}><ChevronDown /></button></li>)}</ol>
          <div className="priority-caption">A life is more than a to-do list.</div>
        </section>

        <section className="task-list-section">
          <div className="task-section-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> Matters for the day</p><h2>The tasks</h2><p>Up to six requests. Every one must make its case.</p></div><div className="requested-total"><span>Total requested</span><strong>{totalRequested} <small>min</small></strong></div></div>
          <div className="task-cards">{caseData.tasks.map((task, index) => <TaskEditor key={task.id} task={task} allTasks={caseData.tasks} number={index + 1} busy={busy} onUpdate={(patch) => updateTask(task.id, patch)} onRemove={() => removeTask(task.id)} />)}</div>
          {caseData.tasks.length < 6 && <button className="add-task-card" onClick={addTask} disabled={busy}><span><Plus /></span><strong>Add a task to the docket</strong><small>{6 - caseData.tasks.length} {caseData.tasks.length === 5 ? "place" : "places"} remaining</small></button>}
        </section>

        {error && <div className="replay-error"><div><strong>Not connected to the live court.</strong><span>Retry the request, or open the included replay case.</span></div><div className="replay-actions"><Button variant="outline" onClick={onStart} disabled={busy}><RotateCcw data-icon="inline-start" /> Retry</Button><Button onClick={onReplay} disabled={busy}><Gavel data-icon="inline-start" /> Use replay</Button></div></div>}
        <div className="docket-actions"><Button variant="outline" onClick={onLoadDemo} disabled={busy}><RotateCcw data-icon="inline-start" /> Load demo case</Button><Button className="start-trial-button" onClick={onStart} disabled={busy}><Gavel data-icon="inline-start" /> Start the trial <ArrowRight data-icon="inline-end" /></Button></div>
      </div>
      <aside className="docket-aside"><div className="aside-note"><span className="wax-seal"><Gavel /></span><p className="aside-kicker">A note from the bench</p><p>“An empty calendar is not a failure of ambition. It is the space in which good work can happen.”</p><span className="aside-signature">— The Honourable Day</span></div><div className="aside-detail"><span className="detail-rule" /><p><strong>{caseData.tasks.length} requests</strong> are waiting to be heard.</p><p>Nothing will be scheduled until the court reaches its verdict.</p></div><div className="aside-index"><span>THE RECORD</span><span>VOL. 01&nbsp; / &nbsp;TODAY</span></div></aside>
    </div>
  </section>
}

function TaskEditor({ task, allTasks, number, busy, onUpdate, onRemove }: { task: Task; allTasks: Task[]; number: number; busy: boolean; onUpdate: (patch: Partial<Task>) => void; onRemove: () => void }) {
  const [newFact, setNewFact] = useState("")
  const addFact = () => { const fact = newFact.trim(); if (fact) { onUpdate({ facts: [...task.facts, fact] }); setNewFact("") } }
  return <article className="task-editor">
    <div className="task-editor-head"><span className="task-number">{String(number).padStart(2, "0")}</span><label className="task-title-field"><span className="sr-only">Task title</span><input value={task.title} disabled={busy} onChange={(event) => onUpdate({ title: event.target.value })} /></label><button className="icon-button subtle" aria-label={`Remove ${task.title}`} disabled={busy} onClick={onRemove}><X /></button></div>
    <div className="task-editor-grid">
      <label>Requested minutes<input type="number" min="1" value={task.duration_min} disabled={busy} onChange={(event) => onUpdate({ duration_min: Math.max(1, Number(event.target.value) || 1) })} /></label>
      <label>Smallest version<input type="number" min="0" value={task.minimum_min} disabled={busy} onChange={(event) => onUpdate({ minimum_min: Math.max(0, Number(event.target.value) || 0) })} /></label>
      <label>Category<select value={task.category} disabled={busy} onChange={(event) => onUpdate({ category: event.target.value as Category })}>{allCategories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}<option value="other">Other</option></select></label>
      <label>Deadline <span className="optional-label">optional</span><input type="time" value={task.deadline ?? ""} disabled={busy} onChange={(event) => onUpdate({ deadline: event.target.value || null })} /></label>
      <label className="depends-field">Depends on <span className="optional-label">optional · ⌘/Ctrl to select more</span><select multiple value={task.depends_on} disabled={busy} onChange={(event) => onUpdate({ depends_on: Array.from(event.target.selectedOptions, (option) => option.value) })}>{allTasks.filter((item) => item.id !== task.id).map((item) => <option key={item.id} value={item.id}>{item.title || "Untitled task"}</option>)}</select></label>
    </div>
    <div className="task-toggles"><label className="switch-row"><input type="checkbox" checked={task.mandatory} disabled={busy} onChange={(event) => onUpdate({ mandatory: event.target.checked })} /><span className="switch-indicator" /><span>Mandatory</span></label><label className="switch-row"><input type="checkbox" checked={task.allow_reduction} disabled={busy} onChange={(event) => onUpdate({ allow_reduction: event.target.checked })} /><span className="switch-indicator" /><span>Allow reduction</span></label></div>
    <div className="facts-box"><div className="facts-heading"><span>Facts in evidence</span><span>Confirmed only</span></div><div className="fact-chips">{task.facts.map((fact, index) => <span className="fact-chip" key={`${fact}-${index}`}>{fact}<button aria-label={`Remove fact: ${fact}`} disabled={busy} onClick={() => onUpdate({ facts: task.facts.filter((_, factIndex) => factIndex !== index) })}><X /></button></span>)}{task.facts.length === 0 && <span className="fact-empty">No facts added yet.</span>}</div><div className="fact-input-row"><input value={newFact} disabled={busy} onChange={(event) => setNewFact(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); addFact() } }} placeholder="Add a short, confirmed fact…" aria-label="Add a confirmed fact" /><button className="icon-button" disabled={busy || !newFact.trim()} onClick={addFact} aria-label="Add fact"><Plus /></button></div></div>
  </article>
}

function PriorityMark({ category }: { category: Category }) {
  const marks: Record<string, string> = { health: "✳", learning: "⌘", work: "▤", money: "£", family: "♡", leisure: "◌", other: "·" }
  return <span aria-hidden="true">{marks[category]}</span>
}

function EmptyDayPreview({ caseData }: { caseData: Case }) {
  return <div className="empty-preview"><div className="preview-caption"><span>Your calendar, before trial</span><span>EMPTY BY DESIGN</span></div><div className="preview-strip"><div className="preview-time-labels"><span>{caseData.constitution.start}</span><span>{caseData.constitution.end}</span></div><div className="preview-track"><span className="preview-free">Free to be decided</span>{caseData.constitution.fixed_blocks.map((block, index) => <span key={index} className="preview-fixed" style={{ left: `${timePercent(block.start, caseData.constitution.start, caseData.constitution.end)}%`, width: `${Math.max(5, timeDurationPercent(block.start, block.end, caseData.constitution.start, caseData.constitution.end))}%` }} title={block.label} />)}</div><div className="preview-legend"><span><i className="legend-free" />Open space</span><span><i className="legend-fixed" />Fixed time</span></div></div></div>
}

function CourtroomStage({ result, caseData, onVerdict, onAutoVerdict, onCrossExamine, witnessTaskId, ratings, busy }: { result: TrialResult; caseData: Case; onVerdict: () => void; onAutoVerdict: () => void; onCrossExamine: (id: string) => void; witnessTaskId: string | null; ratings: Record<string, InterrogationResult["rating"]>; busy: boolean }) {
  const reduceMotion = useReducedMotion()
  const [phase, setPhase] = useState<"entrance" | "defense" | "objection" | "verdict" | "complete">("entrance")
  const [activeIndex, setActiveIndex] = useState(-1)
  const autoVerdictRef = useRef(onAutoVerdict)
  const count = result.decisions.length

  useEffect(() => { autoVerdictRef.current = onAutoVerdict }, [onAutoVerdict])
  useEffect(() => {
    if (!count) return
    if (reduceMotion) {
      setPhase("complete")
      return
    }
    const timers: number[] = []
    const schedule = (delay: number, callback: () => void) => { timers.push(window.setTimeout(callback, delay)) }
    const entranceStep = 150
    const defenseStep = 650
    const objectionStep = 360
    const entranceEnd = Math.max(250, count * entranceStep)

    result.decisions.forEach((_, index) => {
      schedule(index * entranceStep, () => { setPhase("entrance"); setActiveIndex(index) })
      schedule(entranceEnd + 160 + index * defenseStep, () => { setPhase("defense"); setActiveIndex(index) })
      schedule(entranceEnd + 160 + count * defenseStep + 120 + index * objectionStep, () => { setPhase("objection"); setActiveIndex(index) })
    })
    const verdictAt = entranceEnd + 160 + count * defenseStep + 120 + count * objectionStep + 120
    schedule(verdictAt, () => setPhase("verdict"))
    schedule(verdictAt + 950, () => { setPhase("complete"); autoVerdictRef.current() })
    return () => timers.forEach(window.clearTimeout)
  }, [count, reduceMotion, result.decisions])

  const shake = !reduceMotion && (phase === "objection" || phase === "verdict")
  return <motion.section className="stage-shell courtroom-stage" initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={undefined} transition={{ duration: reduceMotion ? 0 : 0.32 }}>
    <div className="stage-heading court-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> The evidence is heard</p><h1>The Courtroom</h1><p className="stage-intro">Five matters. Two sides. One honest ruling.</p></div><div className="court-session">SESSION <strong>01</strong><span> · </span>{count} TESTIMONIES</div></div>
    <motion.div className={`court-hall ${phase === "verdict" ? "verdict-flash" : ""}`} animate={shake ? { x: [0, -3, 4, -2, 0] } : { x: 0 }} transition={{ duration: phase === "verdict" ? 0.42 : 0.3 }}>
      <div className="courtroom-columns"><span>THE DEFENCE</span><div className="prosecutor-counsel"><span>THE PROSECUTION</span><Prosecutor objecting={phase === "objection"} smirking={Object.values(ratings).includes("contradiction")} /></div></div>
      {result.decisions.map((decision, index) => {
        const task = decision.task_id
        const sourceTaskCategory = caseData.tasks.find((item) => item.id === task)?.category ?? "work"
        const arrived = reduceMotion || phase !== "entrance" || index <= activeIndex
        const defenseActive = phase === "defense" && index === activeIndex
        const objecting = phase === "objection" && index === activeIndex
        return <motion.div className={`testimony-row ${arrived ? "witness-arrived" : ""} ${defenseActive ? "witness-speaking" : ""}`} key={task} initial={reduceMotion ? false : { opacity: 0, x: -75 }} animate={arrived ? { opacity: 1, x: 0 } : { opacity: 0, x: -75 }} transition={{ duration: reduceMotion ? 0 : 0.38, delay: phase === "entrance" && !arrived ? 0 : index * 0.02 }}>
          <div className="witness-identity"><TaskCharacter category={sourceTaskCategory} emoji={decision.persona.emoji} name={decision.persona.name} title={decision.effective_title} variant="defendant" number={index + 1} compact selected={defenseActive || witnessTaskId === task} mood={ratings[task] ?? null} onClick={() => onCrossExamine(task)} /></div>
          <div className={`testimony-bubble defense-bubble ${defenseActive ? "bubble-speaking" : ""}`}><span className="bubble-label">DEFENCE</span><p><TypedLine text={decision.defense} active={defenseActive} /></p>{objecting && <motion.span className="objection-stamp" initial={{ opacity: 0, scale: 2.5, rotate: 18 }} animate={{ opacity: 1, scale: 1, rotate: -8 }} transition={{ type: "spring", stiffness: 480, damping: 18 }}>OBJECTION!</motion.span>}</div>
          <div className={`testimony-bubble prosecution-bubble ${objecting ? "bubble-objecting" : ""}`}><span className="bubble-label">PROSECUTION</span><p><TypedLine text={decision.prosecution} active={objecting} /></p></div>
        </motion.div>
      })}
      <div className="judge-bench"><Judge striking={phase === "verdict"} /><div className="judge-gavel-line" /><p className="judge-summary">{result.judge_summary}</p></div>
      <AnimatePresence>{phase === "verdict" && !reduceMotion && <motion.span className="verdict-flash-overlay" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.72, 0] }} transition={{ duration: 0.72 }} />}</AnimatePresence>
    </motion.div>
    <div className="courtroom-bottom"><div><span className="motion-dot" /> {phase === "complete" ? "The record is complete" : phase === "verdict" ? "The judge is reaching a verdict" : "Witnesses are being heard"}</div><Button onClick={onVerdict} disabled={busy}>See the verdict <ArrowRight data-icon="inline-end" /></Button></div>
  </motion.section>
}

function SentenceStage({ result, caseData, credibility, ratings, skipAnimations, selectedTaskId, onCrossExamine, onBack, busy }: { result: TrialResult; caseData: Case; credibility: Record<string, number>; ratings: Record<string, InterrogationResult["rating"]>; skipAnimations: boolean; selectedTaskId: string | null; onCrossExamine: (id: string) => void; onBack: () => void; busy: boolean }) {
  const reduceMotion = useReducedMotion()
  const animateSentence = !skipAnimations && !reduceMotion
  const groups = useMemo(() => ({
    APPROVED: result.decisions.filter((decision) => decision.verdict === "APPROVED"),
    REDUCED: result.decisions.filter((decision) => decision.verdict === "REDUCED"),
    DISMISSED: result.decisions.filter((decision) => decision.verdict === "DISMISSED"),
  }), [result.decisions])
  return <motion.section className="stage-shell sentence-stage" initial={animateSentence ? { opacity: 0, y: 16 } : false} animate={{ opacity: 1, y: 0 }} exit={animateSentence ? { opacity: 0, y: -12 } : undefined} transition={{ duration: animateSentence ? 0.42 : 0 }}>
    <LayoutGroup id="sentence-ruling">
      <div className="stage-heading sentence-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> Order of the court</p><h1>The Sentence</h1><p className="stage-intro">A considered day, with room left to breathe.</p></div><Button variant="outline" onClick={onBack} disabled={busy}><ArrowLeft data-icon="inline-start" /> Review evidence</Button></div>
      {result.status === "conflict" && <div className="conflict-banner" role="alert"><AlertCircle /><div><strong>The court has identified a conflict.</strong>{result.conflicts.map((conflict) => <p key={conflict.code}>{conflict.message}</p>)}</div></div>}
      {result.change && <motion.div className="change-note" initial={animateSentence ? { opacity: 0, y: -8 } : false} animate={{ opacity: 1, y: 0 }}><span className="change-spark"><Sparkles /></span><Judge nodding disableMotion={!animateSentence} /><div><strong>Change of ruling</strong><span>{result.decisions.find((decision) => decision.task_id === result.change?.task_id)?.effective_title}: {result.change.previous_verdict} → {result.change.new_verdict}. {Math.abs(result.change.delta_minutes_recovered)} minutes returned to the day.</span></div><span className="change-tag">APPEAL GRANTED</span></motion.div>}
      <motion.div className="sentence-summary" initial={animateSentence ? { opacity: 0, scale: 0.985 } : false} animate={{ opacity: 1, scale: 1 }} transition={{ delay: animateSentence ? 0.15 : 0 }}><div><span className="summary-overline">THE RULING</span><strong><AnimatedMinutes value={result.metrics.minutes_recovered} /><small> min</small></strong><span>returned to you</span></div><div className="summary-divider" /><div className="summary-copy"><span>THE DAY IS YOURS AGAIN</span><p>{result.judge_summary}</p></div><div className="summary-capacity"><span>Free capacity</span><strong><AnimatedMinutes value={result.metrics.free_capacity_min} /> <small>min</small></strong></div></motion.div>
      <div className="sentence-layout">
        <div className="verdict-columns">{(["APPROVED", "REDUCED", "DISMISSED"] as const).map((verdict) => {
          const meta = verdictMeta[verdict]
          const Icon = meta.icon
          return <section className={`verdict-column ${meta.tone}`} key={verdict}>
            <div className="verdict-column-head"><div className="verdict-title"><span className="verdict-icon"><Icon /></span><div><h2>{meta.title}</h2><span>{meta.eyebrow}</span></div></div><span className="verdict-count">{groups[verdict].length}</span></div>
            <div className="verdict-card-list">{groups[verdict].length === 0 && <div className="column-empty">No matters in this column.</div>}{groups[verdict].map((decision, index) => <DecisionCard key={decision.task_id} decision={decision} sourceTask={caseData.tasks.find((task) => task.id === decision.task_id)} credibility={credibility[decision.task_id] ?? 50} mood={ratings[decision.task_id] ?? null} selected={selectedTaskId === decision.task_id} animateCard={animateSentence} index={index} onCrossExamine={() => onCrossExamine(decision.task_id)} />)}</div>
          </section>
        })}</div>
        <Timeline result={result} caseData={caseData} animateTimeline={animateSentence} />
      </div>
      <CourtOrders result={result} caseData={caseData} ratings={ratings} witnessTaskId={selectedTaskId} disableMotion={!animateSentence} onCrossExamine={onCrossExamine} />
    </LayoutGroup>
  </motion.section>
}

function DecisionCard({ decision, sourceTask, credibility, mood, selected, animateCard, index, onCrossExamine }: { decision: Decision; sourceTask?: Task; credibility: number; mood: InterrogationResult["rating"] | null; selected: boolean; animateCard: boolean; index: number; onCrossExamine: () => void }) {
  const reduceMotion = useReducedMotion()
  const meta = verdictMeta[decision.verdict]
  const pending = decision.schedule_status === "PENDING"
  const characterCategory = sourceTask?.category ?? "other"
  const originalCardHeight = Math.min(340, 198 + Math.min(decision.original_min, 150) * 0.72)
  const targetCardHeight = Math.min(340, 198 + Math.min(decision.approved_min, 150) * 0.72)
  const shouldMove = animateCard && !reduceMotion
  return <motion.article layout layoutId={`task-card-${decision.task_id}`} className={`decision-card ${meta.tone} ${shouldMove ? "sentence-card-animating" : ""}`} style={{ minHeight: `${shouldMove ? originalCardHeight : targetCardHeight}px` }} initial={shouldMove ? { opacity: 0, y: 18, scale: 0.97 } : false} animate={{ opacity: 1, y: 0, scale: 1, minHeight: `${targetCardHeight}px` }} transition={{ duration: shouldMove ? 0.48 : 0, delay: shouldMove ? index * 0.28 : 0, layout: { type: "spring", stiffness: 150, damping: 20 } }}>
    {shouldMove && <>
      {decision.verdict === "REDUCED" && <><motion.span className="sentence-scissors" aria-hidden="true" initial={{ x: -160, rotate: -15, opacity: 0 }} animate={{ x: [ -160, 0, 170 ], rotate: [-15, 8, -4], opacity: [0, 1, 0] }} transition={{ delay: 0.4 + index * 0.28, duration: 0.82, times: [0, 0.35, 1] }}>✂️</motion.span><motion.span className="reduction-offcut" initial={{ opacity: 0, y: 0, rotate: 0 }} animate={{ opacity: [0, 1, 0], y: [0, 36, 88], rotate: [0, 12, 22] }} transition={{ delay: 0.85 + index * 0.28, duration: 0.9 }}>−{decision.saved_min} min</motion.span></>}
      <motion.span className={`sentence-stamp stamp-${meta.tone}`} initial={{ opacity: 0, scale: 2.4, rotate: 17 }} animate={{ opacity: [0, 1, 1, 0.9], scale: [2.4, 0.92, 1.04, 1], rotate: [17, -8, -7, -7] }} transition={{ delay: 0.45 + index * 0.28, duration: 0.58, times: [0, 0.55, 0.76, 1] }}>{meta.title.toUpperCase()}</motion.span>
      {decision.verdict === "DISMISSED" && <motion.span className="dismissed-minutes" initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 1, 0], y: [0, 42, 100] }} transition={{ delay: 0.9 + index * 0.28, duration: 0.9 }}>{decision.original_min} min</motion.span>}
    </>}
    <div className="decision-persona"><span className={`decision-status ${pending ? "pending-status" : ""}`}>{pending && <Clock3 />}{pending ? "Approved · no slot today" : meta.title}</span></div>
    <TaskCharacter category={characterCategory} emoji={decision.persona.emoji} name={decision.persona.name} title={decision.effective_title} variant={decision.verdict === "DISMISSED" ? "defendant" : "on-duty"} plan={decision.action_plan} compact mood={mood} selected={selected} disableMotion={!shouldMove && !selected} exiting={decision.verdict === "DISMISSED" && shouldMove} onClick={onCrossExamine} />
    <h3>{decision.effective_title}</h3>
    {decision.saved_min > 0 && <div className="saved-badge">SAVED {decision.saved_min} MIN</div>}
    <div className="duration-line"><span className="duration-original struck">{decision.original_min}</span><ArrowRight /><strong>{decision.approved_min} min</strong></div>
    {pending && <div className="pending-explanation"><Clock3 /> Approved · no slot today</div>}
    <p className="decision-reason">{decision.reason}</p>
    {decision.cut_scope.length > 0 && <div className="cut-scope"><span>NOT TODAY</span><ul>{decision.cut_scope.map((item) => <li key={item}><s>{item}</s></li>)}</ul></div>}
    {decision.verdict === "DISMISSED" && decision.release && <div className="release-note"><span className={`release-tag release-${decision.release.action}`}>{decision.release.action}</span><p>{decision.release.note}</p></div>}
    {decision.verdict !== "DISMISSED" && decision.first_move && <div className="first-move"><span>⚡ FIRST MOVE</span><p>{decision.first_move}</p></div>}
    {decision.verdict !== "DISMISSED" && decision.action_plan.length > 0 && <ol className="action-plan">{decision.action_plan.slice(0, 3).map((step, stepIndex) => <li key={step.step}><span>{stepIndex + 1}</span><span>{step.step}</span><small>{step.minutes} min</small></li>)}</ol>}
    {decision.done_when && <p className="done-when"><strong>Done when:</strong> {decision.done_when}</p>}
    {decision.suggested_need && <span className="need-chip">Need: {decision.suggested_need.need} · {decision.suggested_need.status === "unconfirmed" ? "suggested" : "confirmed"}</span>}
    <div className="credibility"><div className="credibility-label"><span>Credibility</span><strong>{credibility}%</strong></div><div className="credibility-track"><span style={{ width: `${credibility}%` }} /></div></div>
    <Button variant="outline" size="sm" className="cross-examine-button" onClick={onCrossExamine}>Cross-examine <ArrowRight data-icon="inline-end" /></Button>
  </motion.article>
}

function Timeline({ result, caseData, animateTimeline }: { result: TrialResult; caseData: Case; animateTimeline: boolean }) {
  const reduceMotion = useReducedMotion()
  const shouldAnimate = animateTimeline && !reduceMotion
  const dayStart = toMinutes(caseData.constitution.start)
  const dayEnd = toMinutes(caseData.constitution.end)
  const total = Math.max(dayEnd - dayStart, 1)
  const scheduled = result.schedule.map((slot) => ({ ...slot, task: caseData.tasks.find((task) => task.id === slot.task_id) })).filter((slot) => slot.task)
  const events = [
    ...scheduled.map((slot) => ({ start: slot.start, end: slot.end, label: slot.task?.title ?? "Task", category: slot.task?.category ?? "other", type: "task" as const })),
    ...caseData.constitution.fixed_blocks.map((block) => ({ start: block.start, end: block.end, label: block.label, category: "other", type: "fixed" as const })),
  ].sort((a, b) => a.start.localeCompare(b.start))
  const free = [] as { start: number; end: number }[]
  let cursor = dayStart
  for (const event of events) {
    const start = Math.max(dayStart, toMinutes(event.start))
    const end = Math.min(dayEnd, toMinutes(event.end))
    if (start > cursor) free.push({ start: cursor, end: start })
    cursor = Math.max(cursor, end)
  }
  if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd })
  const chartHeight = 600
  const itemStyle = (start: string, end: string) => {
    const top = ((toMinutes(start) - dayStart) / total) * chartHeight
    const height = ((toMinutes(end) - toMinutes(start)) / total) * chartHeight
    return { top: `${top}px`, height: `${Math.max(height, 22)}px` }
  }
  return <aside className="timeline-panel"><div className="timeline-header"><div><p className="eyebrow"><span className="eyebrow-line" /> The shape of today</p><h2>Your timeline</h2></div><span className="timeline-empty-note">SPACE IS A SENTENCE TOO</span></div>
    <div className="timeline-legend"><span><i className="timeline-legend-task" />Scheduled</span><span><i className="timeline-legend-fixed" />Fixed</span><span><i className="timeline-legend-free" />Free</span></div>
    <div className="timeline-chart"><div className="timeline-hours" aria-hidden="true">{Array.from({ length: Math.floor(total / 60) + 1 }, (_, index) => dayStart + index * 60).filter((minute) => minute <= dayEnd).map((minute) => <span key={minute} style={{ top: `${((minute - dayStart) / total) * chartHeight}px` }}>{formatTime(minute)}</span>)}</div><div className="timeline-track" style={{ height: chartHeight }}>
      {free.map((gap, index) => <motion.div className="timeline-free-block" key={`free-${gap.start}`} style={{ top: `${((gap.start - dayStart) / total) * chartHeight}px`, height: `${Math.max(((gap.end - gap.start) / total) * chartHeight, 22)}px` }} animate={shouldAnimate ? { scale: [1, 1.012, 1] } : undefined} transition={shouldAnimate ? { delay: 1 + index * 0.08, duration: 2.4, repeat: Infinity, ease: "easeInOut" } : undefined}><span>Free</span><small>{formatTime(gap.start)} – {formatTime(gap.end)}</small></motion.div>)}
      {events.map((event, index) => <motion.div key={`${event.type}-${event.start}-${index}`} className={`timeline-event ${event.type === "fixed" ? "fixed-event" : `category-${event.category}`}`} style={itemStyle(event.start, event.end)} initial={shouldAnimate ? { opacity: 0, x: -18 } : false} animate={{ opacity: 1, x: 0 }} transition={{ duration: shouldAnimate ? 0.38 : 0, delay: shouldAnimate ? 0.55 + index * 0.14 : 0 }}><span>{event.label}</span><small>{event.start} – {event.end}</small></motion.div>)}
    </div></div>
    <div className="timeline-footer"><span>DAY ENDS</span><strong>{caseData.constitution.end}</strong><span>{result.metrics.pending_min > 0 ? `${result.metrics.pending_min} min pending` : "No task fills the day."}</span></div>
  </aside>
}

function PleaPlan({ proposal }: { proposal: NonNullable<InterrogationResult["proposal"]> }) {
  let cursor = toMinutes("12:00")
  return <ol className="plea-plan">{proposal.action_plan.map((item, index) => {
    const start = cursor
    cursor += item.minutes
    return <li key={`${item.step}-${index}`}><span>{formatTime(start)}–{formatTime(cursor)}</span><span>{item.step}</span><small>{item.minutes} min</small></li>
  })}</ol>
}

function CourtOrders({ result, caseData, ratings, witnessTaskId, disableMotion, onCrossExamine }: { result: TrialResult; caseData: Case; ratings: Record<string, InterrogationResult["rating"]>; witnessTaskId: string | null; disableMotion: boolean; onCrossExamine: (id: string) => void }) {
  const reduceMotion = useReducedMotion()
  const [checked, setChecked] = useState<Record<string, boolean[]>>({})
  const [copied, setCopied] = useState(false)
  const orders = result.schedule.map((slot) => ({
    slot,
    task: caseData.tasks.find((item) => item.id === slot.task_id),
    decision: result.decisions.find((item) => item.task_id === slot.task_id),
  })).filter((order) => order.task && order.decision).sort((a, b) => a.slot.start.localeCompare(b.slot.start))

  const copyOrders = async () => {
    const text = ["# Court Orders", "", ...orders.flatMap(({ slot, decision }) => {
      if (!decision) return []
      let cursor = toMinutes(slot.start)
      const lines = [`## ${slot.start}–${slot.end} · ${decision.effective_title} · Saved ${decision.saved_min} min`]
      if (decision.first_move) lines.push(`⚡ First move: ${decision.first_move}`)
      for (const item of decision.action_plan) {
        const start = formatTime(cursor)
        cursor += item.minutes
        lines.push(`- [ ] ${start}–${formatTime(cursor)} ${item.step}`)
      }
      if (decision.done_when) lines.push(`Done when: ${decision.done_when}`)
      return [...lines, ""]
    })].join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setCopied(false)
    }
  }

  return <section className="court-orders-panel" aria-labelledby="orders-title">
    <div className="orders-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> Built for doing, not just planning</p><h2 id="orders-title">Other planners give you a list.<br /><em>The court gives you orders.</em></h2></div><div className="orders-seal"><Gavel /><span>EXECUTABLE<br />ITINERARY</span></div></div>
    <div className="orders-toolbar"><div className="orders-toolbar-copy"><span>COURT ORDERS</span><strong>{orders.length} scheduled matters</strong></div><div className="orders-actions"><Button variant="outline" onClick={copyOrders}><Check data-icon="inline-start" /> {copied ? "Copied" : "Copy my orders"}</Button><Button variant="outline" onClick={() => window.print()}><Printer data-icon="inline-start" /> Print</Button></div></div>
    <div className="orders-list">{orders.length === 0 && <p className="orders-empty">No tasks are scheduled. Your open time stays yours.</p>}{orders.map(({ slot, task, decision }) => {
      if (!task || !decision) return null
      let cursor = toMinutes(slot.start)
      const taskChecks = checked[task.id] ?? decision.action_plan.map(() => false)
      const completed = taskChecks.filter(Boolean).length
      const progress = decision.action_plan.length ? Math.round((completed / decision.action_plan.length) * 100) : 0
      return <article className="order-card" key={task.id}>
        <div className="order-card-head"><div className="order-time-block"><span>{slot.start}</span><i /> <span>{slot.end}</span></div><div className="order-title-block"><span className="order-category">{categoryLabel(task.category)}</span><h3>{decision.effective_title}</h3></div><span className="order-saved-chip">Saved {decision.saved_min} min</span></div>
        <TaskCharacter category={task.category} emoji={decision.persona.emoji} name={decision.persona.name} title={decision.effective_title} variant="on-duty" plan={decision.action_plan} compact mood={ratings[task.id] ?? null} celebrating={decision.action_plan.length > 0 && completed === decision.action_plan.length} selected={witnessTaskId === task.id} disableMotion={disableMotion && completed !== decision.action_plan.length && witnessTaskId !== task.id} onClick={() => onCrossExamine(task.id)} />
        {decision.first_move && <div className="order-first-move"><span>⚡ FIRST MOVE</span><p>{decision.first_move}</p></div>}
        <ol className="order-checklist">{decision.action_plan.map((item, index) => {
          const start = cursor
          cursor += item.minutes
          const isChecked = Boolean(taskChecks[index])
          return <li key={`${task.id}-${index}`} className={isChecked ? "step-done" : ""}><label><input type="checkbox" checked={isChecked} aria-label={`Mark complete: ${item.step}`} onChange={(event) => setChecked((previous) => { const next = [...(previous[task.id] ?? decision.action_plan.map(() => false))]; next[index] = event.target.checked; return { ...previous, [task.id]: next } })} /><motion.span className="checkmark-box" initial={false} animate={reduceMotion ? { scale: 1, rotate: 0 } : isChecked ? { scale: [0.65, 1.16, 1], rotate: [0, -10, 0] } : { scale: 1, rotate: 0 }} transition={{ duration: reduceMotion ? 0 : 0.28 }}><Check /></motion.span><span className="order-step-time">{formatTime(start)}–{formatTime(cursor)}</span><span className="order-step-name">{item.step}</span><span className="order-step-duration">{item.minutes} min</span></label></li>
        })}</ol>
        {decision.done_when && <p className="order-done-when"><strong>Done when:</strong> {decision.done_when}</p>}
        <div className="order-progress"><div className="order-progress-label"><span>Progress</span><span>{completed} of {decision.action_plan.length} steps</span></div><div className="order-progress-track"><span style={{ width: `${progress}%` }} /></div></div>
      </article>
    })}</div>
    <div className="orders-footnote"><span>THE DAY IS NOT FULL. THAT IS THE POINT.</span><span>{result.metrics.free_capacity_min} MINUTES LEFT UNCLAIMED</span></div>
  </section>
}

function CrossExaminationSheet({ task, decision, answer, count, credibility, busy, appealUsed, appealFact, error, onClose, onAsk, onFact, onAccept, onDismissError }: {
  task: Task; decision: Decision | null; answer: InterrogationResult | null; count: number; credibility: number; busy: boolean; appealUsed: boolean; appealFact: string; error: string; onClose: () => void; onAsk: (type: QuestionType, freeText?: string) => void; onFact: (value: string) => void; onAccept: () => void; onDismissError: () => void
}) {
  const [freeQuestion, setFreeQuestion] = useState("")
  const questionRemaining = Math.max(0, 3 - count)
  const ratingLabels = { supported: "Supported", evasive: "Evasive", contradiction: "Contradiction" }
  const submitFreeQuestion = () => {
    const question = freeQuestion.trim()
    if (question) { onAsk("free", question); setFreeQuestion("") }
  }
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="cross-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div className="sheet-topline"><span>THE WITNESS STAND</span><button className="icon-button" onClick={onClose} aria-label="Close cross-examination"><X /></button></div>
      <div className="sheet-heading"><span className="sheet-avatar">{decision?.persona.emoji ?? "⚖️"}</span><div><p className="eyebrow"><span className="eyebrow-line" /> Cross-examination</p><h2 id="sheet-title">{decision?.effective_title ?? task.title}</h2><span>{decision?.persona.name}</span></div></div>
      <div className="question-counter"><span>Questions remaining</span><strong>{questionRemaining} / 3</strong><div className="counter-dots">{[0, 1, 2].map((dot) => <i key={dot} className={dot < count ? "used" : ""} />)}</div></div>
      <p className="sheet-instruction">Choose a line of questioning. The witness may offer a more reasonable plea.</p>
      <div className="question-list">{questions.map((question) => <button key={question.type} disabled={busy || questionRemaining === 0} onClick={() => onAsk(question.type)}><span>{question.label === "What&apos;s your smallest version?" ? "What’s your smallest version?" : question.label}</span><ArrowRight /></button>)}</div>
      <form className="free-question-form" onSubmit={(event) => { event.preventDefault(); submitFreeQuestion() }}><label htmlFor="free-question">Ask your own question</label><div><input id="free-question" value={freeQuestion} onChange={(event) => setFreeQuestion(event.target.value)} placeholder="Put your question to the witness…" disabled={busy || questionRemaining === 0} /><button type="submit" disabled={busy || questionRemaining === 0 || !freeQuestion.trim()} aria-label="Send question"><Send /></button></div></form>
      {error && <div className="sheet-error" role="alert"><span>{error}</span><button onClick={onDismissError} aria-label="Dismiss error"><X /></button></div>}
      {answer && <div className="answer-card"><div className="answer-meta"><span>THE WITNESS ANSWERS</span><span className={`rating-badge rating-${answer.rating}`}>{answer.rating === "supported" ? <CheckCircle2 /> : answer.rating === "evasive" ? <AlertCircle /> : <X />}{ratingLabels[answer.rating]}</span></div><div className="answer-bubble"><span className="answer-avatar">{decision?.persona.emoji}</span><p>{answer.answer}</p></div><div className="sheet-credibility"><span>Credibility</span><strong>{credibility}%</strong><div className="credibility-track"><span style={{ width: `${credibility}%` }} /></div></div>
        {answer.proposal && <div className="plea-card"><div className="plea-kicker"><ShieldCheck /> A possible plea deal</div><h3>{answer.proposal.title}</h3><div className="plea-duration"><s>{task.duration_min} min</s><ArrowRight /><strong>{answer.proposal.duration_min} min</strong></div><span className="saved-badge plea-saved">SAVED {answer.proposal.saved_min} MIN</span><span className="need-chip">Need: {answer.proposal.need}</span>{answer.proposal.cut_scope.length > 0 && <div className="cut-scope plea-cut-scope"><span>NOT TODAY</span><ul>{answer.proposal.cut_scope.map((item) => <li key={item}><s>{item}</s></li>)}</ul></div>}<div className="plea-first-move"><span>⚡ FIRST MOVE</span><p>{answer.proposal.first_move}</p></div><PleaPlan proposal={answer.proposal} /><p className="plea-done-when"><strong>Done when:</strong> {answer.proposal.done_when}</p><label className="new-fact-label">Add a new fact <span>optional</span><input value={appealFact} onChange={(event) => onFact(event.target.value)} placeholder="Something the court should know…" disabled={busy} /></label><div className="plea-actions"><Button variant="outline" onClick={onClose} disabled={busy}>Reject</Button><Button onClick={onAccept} disabled={busy || appealUsed}>{appealUsed ? "Appeal used" : "Accept plea"}</Button></div>{appealUsed && <p className="appeal-used-note">One appeal has already been used in this trial.</p>}</div>}
      </div>}
      {!answer && <div className="sheet-record"><span className="record-rule" /><p>One careful question can be worth more than an hour of anxious planning.</p></div>}
    </aside>
  </div>
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number)
  return (hours || 0) * 60 + (minutes || 0)
}

function formatTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function timePercent(time: string, start: string, end: string) {
  const span = Math.max(toMinutes(end) - toMinutes(start), 1)
  return Math.max(0, Math.min(100, ((toMinutes(time) - toMinutes(start)) / span) * 100))
}

function timeDurationPercent(start: string, end: string, dayStart: string, dayEnd: string) {
  return Math.max(0, ((toMinutes(end) - toMinutes(start)) / Math.max(toMinutes(dayEnd) - toMinutes(dayStart), 1)) * 100)
}
