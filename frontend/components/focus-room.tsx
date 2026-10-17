"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, FastForward, Pause, Play, Send, SkipForward, X } from "lucide-react"
import { JudgeCharacter, TaskCharacter } from "@/components/task-character-art"
import type { Archetype, Decision, PlanStep, Task } from "@/lib/types"

type ChatLine = { who: "you" | "task"; text: string }

interface FocusRoomProps {
  task: Task
  decision: Decision
  archetype: Archetype
  slot?: { start: string; end: string; buffer_min: number }
  plan: PlanStep[]
  firstMove: string
  doneWhen: string
  judgePresets: string[]
  judgeBusy: boolean
  judgeError: string
  onAskTask: (question: string) => Promise<string>
  onAskJudge: (instruction: string) => void
  onReconvene: () => Promise<void>
  onClose: () => void
}

const QUICK_QUESTIONS = ["How do I start?", "What's the hardest part?", "Can we finish early?", "Motivate me"]

const toMinutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m }
const clock = (value: number) => `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`

/** Working session for one task: its character coaches you, the clock runs per phase, the judge can rewrite the order. */
export function FocusRoom({ task, decision, archetype, slot, plan, firstMove, doneWhen, judgePresets, judgeBusy, judgeError, onAskTask, onAskJudge, onReconvene, onClose }: FocusRoomProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState((plan[0]?.minutes ?? 0) * 60)
  const [running, setRunning] = useState(true)
  const [demoSpeed, setDemoSpeed] = useState(false)
  const [finished, setFinished] = useState(false)
  const [chat, setChat] = useState<ChatLine[]>([{ who: "task", text: `Right. First move: ${firstMove}` }])
  const [question, setQuestion] = useState("")
  const [thinking, setThinking] = useState(false)
  const [instruction, setInstruction] = useState("")
  const [planNote, setPlanNote] = useState("")
  const [reconvening, setReconvening] = useState(false)
  const planKey = plan.map((step) => `${step.step}:${step.minutes}`).join("|")
  const firstPlan = useRef(planKey)
  const chatEnd = useRef<HTMLDivElement>(null)

  // A new order from the judge restarts the clock on the first phase.
  useEffect(() => {
    if (planKey === firstPlan.current) return
    firstPlan.current = planKey
    setStepIndex(0)
    setSecondsLeft((plan[0]?.minutes ?? 0) * 60)
    setFinished(false)
    setPlanNote("The judge has issued a new order. The clock restarts on phase 1.")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey])

  useEffect(() => {
    if (!running || finished) return
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - (demoSpeed ? 60 : 1))), 1000)
    return () => window.clearInterval(timer)
  }, [running, finished, demoSpeed])

  const goToStep = (index: number) => {
    if (index >= plan.length) { setFinished(true); setRunning(false); setSecondsLeft(0); return }
    setStepIndex(index)
    setSecondsLeft(plan[index].minutes * 60)
  }
  useEffect(() => {
    if (secondsLeft === 0 && running && !finished) goToStep(stepIndex + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft])

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }) }, [chat, thinking])

  const ask = async (text: string) => {
    const clean = text.trim()
    if (!clean || thinking) return
    setChat((lines) => [...lines, { who: "you", text: clean }])
    setQuestion("")
    setThinking(true)
    const answer = await onAskTask(`About the action plan, current phase "${plan[stepIndex]?.step ?? ""}": ${clean}`)
    setChat((lines) => [...lines, { who: "task", text: answer }])
    setThinking(false)
  }

  const start = toMinutes(slot?.start ?? "00:00") + (slot?.buffer_min ?? 0)
  let cursor = start
  const step = plan[stepIndex]
  const total = (step?.minutes ?? 1) * 60
  const progress = finished ? 1 : 1 - secondsLeft / Math.max(total, 1)
  const latestTaskLine = [...chat].reverse().find((line) => line.who === "task")?.text

  return <div className="focus-overlay" role="dialog" aria-modal="true" aria-label={`Focus session: ${decision.effective_title}`}>
    <button className="focus-close" onClick={onClose} aria-label="Leave the focus session"><X /></button>
    <header className="focus-header"><span>COURT ORDER IN PROGRESS</span><h2>{decision.effective_title}</h2><p>{slot ? `${slot.start}–${slot.end}` : "Unscheduled"} · {decision.approved_min} min · Done when: {doneWhen}</p></header>
    <div className="focus-grid">
      <section className="focus-task">
        <div className="focus-character"><TaskCharacter archetype={archetype} variant="on-duty" state={thinking ? "speaking" : running ? "idle" : "sitting"} label={`${task.title}, on duty`} /></div>
        <AnimatePresence mode="wait">{latestTaskLine && <motion.p key={latestTaskLine} className="focus-speech" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>{thinking ? "…" : latestTaskLine}</motion.p>}</AnimatePresence>
        <div className="focus-chat" aria-live="polite">{chat.map((line, index) => <p key={index} className={`chat-${line.who}`}><b>{line.who === "you" ? "You" : decision.persona.name}</b>{line.text}</p>)}{thinking && <p className="chat-task"><b>{decision.persona.name}</b>…</p>}{/restarted/i.test(latestTaskLine ?? "") && <button className="focus-reconvene" disabled={reconvening} onClick={async () => { setReconvening(true); await onReconvene(); setReconvening(false); setChat((lines) => [...lines, { who: "task", text: "⚖ The court has reconvened with the same case. Ask me again." }]) }}>{reconvening ? "Reconvening…" : "⟳ Reconvene the court"}</button>}<div ref={chatEnd} /></div>
        <div className="focus-quick">{QUICK_QUESTIONS.map((text) => <button key={text} onClick={() => ask(text)} disabled={thinking}>{text}</button>)}</div>
        <form className="focus-input" onSubmit={(event) => { event.preventDefault(); void ask(question) }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={`Ask ${task.title.toLowerCase()} about the plan…`} /><button disabled={!question.trim() || thinking} aria-label="Send question"><Send /></button></form>
      </section>
      <section className="focus-clock">
        <span className="focus-phase-label">{finished ? "ORDER COMPLETE" : `PHASE ${stepIndex + 1} OF ${plan.length}`}</span>
        <div className="focus-ring" style={{ ["--progress" as string]: `${Math.round(progress * 360)}deg` }}><strong>{finished ? "Done" : mmss(secondsLeft)}</strong><small>{finished ? doneWhen : step?.step}</small></div>
        {!finished && step && (step.detail || step.tip) && <div className="focus-detail">{step.detail && <p>{step.detail}</p>}{step.tip && <p className="focus-tip">💡 {step.tip}</p>}</div>}
        <div className="focus-controls">
          {!finished && <button onClick={() => setRunning((value) => !value)}>{running ? <><Pause /> Pause</> : <><Play /> Resume</>}</button>}
          {!finished && <button onClick={() => goToStep(stepIndex + 1)}><SkipForward /> Phase done</button>}
          <button className={demoSpeed ? "active" : ""} onClick={() => setDemoSpeed((value) => !value)} aria-pressed={demoSpeed}><FastForward /> Demo speed</button>
        </div>
        <ol className="focus-phases">{plan.map((item, index) => {
          const begin = cursor
          cursor += item.minutes
          const state = finished || index < stepIndex ? "done" : index === stepIndex ? "current" : "next"
          return <li key={`${item.step}-${index}`} className={`phase-${state}`}><span>{clock(begin)}–{clock(begin + item.minutes)}</span><strong>{state === "done" && <Check />}{item.step}</strong><small>{item.minutes} min</small></li>
        })}</ol>
        {planNote && <p className="focus-note">{planNote}</p>}
      </section>
      <section className="focus-judge">
        <div className="focus-judge-head"><JudgeCharacter striking={judgeBusy} /><div><span>THE BENCH</span><strong>Need a different order?</strong></div></div>
        <div className="focus-presets">{judgePresets.map((preset) => <button key={preset} onClick={() => { setPlanNote(""); onAskJudge(preset) }}>{preset}</button>)}</div>
        <form className="focus-input" onSubmit={(event) => { event.preventDefault(); if (instruction.trim()) { setPlanNote(""); onAskJudge(instruction.trim()); setInstruction("") } }}><input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Tell the judge what to change…" /><button disabled={!instruction.trim()} aria-label="Send to the judge"><Send /></button></form>
        {judgeBusy && <p className="focus-note">The judge is rewriting your order…</p>}
        {judgeError && !judgeBusy && <p className="revision-error">{judgeError}</p>}
      </section>
    </div>
  </div>
}
