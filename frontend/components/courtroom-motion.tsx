"use client"

import { useEffect, useRef, useState } from "react"
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion"
import type { Category, PlanStep } from "@/lib/types"

type CharacterMood = "supported" | "evasive" | "contradiction" | null

type TaskCharacterProps = {
  category: Category
  emoji: string
  name: string
  title: string
  variant: "defendant" | "on-duty"
  plan?: PlanStep[]
  number?: number
  compact?: boolean
  selected?: boolean
  mood?: CharacterMood
  celebrating?: boolean
  exiting?: boolean
  disableMotion?: boolean
  onClick?: () => void
}

const categoryNames: Record<Category, string> = {
  health: "health",
  learning: "learning",
  work: "work",
  money: "money",
  family: "family",
  leisure: "leisure",
  other: "other",
}

export function TaskCharacter({ category, emoji, name, title, variant, plan = [], number, compact = false, selected = false, mood = null, celebrating = false, exiting = false, disableMotion = false, onClick }: TaskCharacterProps) {
  const reduceMotion = useReducedMotion()
  const motionEnabled = !reduceMotion && !disableMotion
  const [look, setLook] = useState(0)
  const onDuty = variant === "on-duty"
  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    setLook(Math.max(-1, Math.min(1, (event.clientX - bounds.left - bounds.width / 2) / (bounds.width / 2))))
  }

  return <motion.button
    type="button"
    className={`task-character category-${categoryNames[category]} ${onDuty ? "on-duty" : "defendant"} ${compact ? "compact" : ""} ${selected ? "witness-selected" : ""} ${mood ? `mood-${mood}` : ""} ${celebrating ? "celebrating" : ""} ${disableMotion ? "motion-disabled" : ""}`}
    aria-label={`${name}, ${title}${onDuty ? ", on duty" : ", defendant"}. Open cross-examination.`}
    onClick={onClick}
    onPointerMove={handlePointerMove}
    onPointerLeave={() => setLook(0)}
    whileHover={motionEnabled ? { scale: 1.04 } : undefined}
    animate={{ scale: motionEnabled ? mood === "evasive" ? 0.94 : mood === "supported" ? 1.06 : 1 : 1, y: motionEnabled && selected ? -6 : 0, x: motionEnabled && exiting ? [0, 0, 120] : 0, opacity: motionEnabled && exiting ? [1, 1, 0] : 1 }}
    transition={motionEnabled && exiting ? { duration: 1.1, delay: 0.7, ease: "easeIn" } : motionEnabled ? { type: "spring", stiffness: 240, damping: 18 } : { duration: 0 }}
  >
    {typeof number === "number" && !onDuty && <span className="character-number">#{String(number).padStart(2, "0")}</span>}
    <motion.span className="character-sparkles" aria-hidden="true" animate={celebrating && motionEnabled ? { opacity: [0, 1, 0], scale: [0.55, 1.2, 0.8], rotate: [0, 24, 0] } : { opacity: 0 }} transition={{ duration: 0.75, repeat: celebrating && motionEnabled ? Infinity : 0 }}>
      <i /><i /><i />
    </motion.span>
    <motion.span className="character-art" aria-hidden="true" animate={motionEnabled ? onDuty ? { y: [0, -3, 0] } : { rotate: [-1.4, 1.4, -1.4] } : undefined} transition={motionEnabled ? { duration: onDuty ? 2.6 : 2.1, repeat: Infinity, ease: "easeInOut" } : undefined}>
      <motion.span className="character-arm character-arm-left" animate={motionEnabled ? { rotate: onDuty ? [-4, 4, -4] : [-8, 9, -8] } : undefined} transition={motionEnabled ? { duration: 2.8, repeat: Infinity, ease: "easeInOut" } : undefined} />
      <motion.span className="character-arm character-arm-right" animate={motionEnabled ? { rotate: onDuty ? [4, -4, 4] : [8, -9, 8] } : undefined} transition={motionEnabled ? { duration: 2.5, repeat: Infinity, ease: "easeInOut" } : undefined} />
      <span className="character-head-wrap">
        {onDuty && <span className={`character-costume character-costume-${category}`} aria-hidden="true"><i /></span>}
        <motion.span className="character-head" animate={motionEnabled ? { rotate: look * 8 } : undefined} transition={{ duration: 0.25 }}>
          <span>{emoji}</span>
          {mood === "evasive" && <span className="character-sweat">⋮</span>}
        </motion.span>
      </span>
      <motion.span className="character-body" animate={motionEnabled && onDuty ? { rotateY: [0, 180, 360] } : undefined} transition={motionEnabled && onDuty ? { duration: 0.68, times: [0, 0.5, 1] } : undefined}>
        <span className="character-button" />
        {onDuty && <span className="character-pocket" />}
      </motion.span>
      <span className="character-legs"><i /><i /></span>
      {onDuty && <span className="character-clipboard" title={plan.map((item) => item.step).join(" · ") || "Ready for the plan"}><b>{plan[0]?.step.slice(0, 8) ?? "PLAN"}</b><i /><i /></span>}
    </motion.span>
    <span className="character-nameplate"><strong>{name}</strong><small>{title}</small></span>
    <AnimatePresence>{onDuty && motionEnabled && <motion.span className="character-poof" aria-hidden="true" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: [0, 0.85, 0], scale: [0.5, 1.35, 1.8] }} transition={{ duration: 0.55 }} />}</AnimatePresence>
  </motion.button>
}

export function Judge({ striking = false, nodding = false, disableMotion = false }: { striking?: boolean; nodding?: boolean; disableMotion?: boolean }) {
  const reduceMotion = useReducedMotion()
  const motionEnabled = !reduceMotion && !disableMotion
  return <div className="judge-character-wrap" aria-label="The Honourable Day, presiding judge" role="img">
    <motion.div className="judge-character" animate={motionEnabled && nodding ? { rotate: [0, 8, -3, 0], y: [0, 2, 0] } : motionEnabled ? { y: [0, -2, 0] } : undefined} transition={nodding ? { duration: 0.6 } : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
      <span className="judge-wig">♛</span><span className="judge-face">👨‍⚖️</span><span className="judge-robe" />
      <motion.span className="judge-gavel" animate={motionEnabled && striking ? { rotate: [0, -38, 22, 0], y: [0, -9, 4, 0] } : { rotate: -23 }} transition={{ duration: 0.65, times: [0, 0.35, 0.7, 1] }} />
    </motion.div>
    <div className="judge-plaque">THE HONOURABLE DAY</div>
  </div>
}

export function Prosecutor({ objecting = false, smirking = false }: { objecting?: boolean; smirking?: boolean }) {
  const reduceMotion = useReducedMotion()
  return <motion.div className={`prosecutor-character ${smirking ? "smirking" : ""}`} aria-label="The prosecutor" role="img" animate={!reduceMotion && objecting ? { y: [0, -18, 0], rotate: [0, -7, 5, 0], scale: [1, 1.1, 1] } : !reduceMotion ? { y: [0, -2, 0] } : undefined} transition={objecting ? { duration: 0.55 } : { duration: 3, repeat: Infinity, ease: "easeInOut" }}>
    <span className="prosecutor-hair" /><span className="prosecutor-face">🧑‍💼</span><span className="prosecutor-suit" /><span className="prosecutor-tie" />
    {smirking && <span className="prosecutor-smirk">⌁</span>}
  </motion.div>
}

export function AnimatedMinutes({ value }: { value: number }) {
  const reduceMotion = useReducedMotion()
  const count = useMotionValue(value)
  const rounded = useTransform(count, (current) => Math.round(current))
  useEffect(() => {
    if (reduceMotion) {
      count.set(value)
      return
    }
    const controls = animate(count, value, { duration: 1.15, ease: "easeOut" })
    return controls.stop
  }, [count, reduceMotion, value])
  return <motion.span>{rounded}</motion.span>
}

export function RecoveredJar({ value }: { value: number }) {
  const reduceMotion = useReducedMotion()
  const previousValue = useRef(value)
  const [drainDelta, setDrainDelta] = useState(0)
  const [draining, setDraining] = useState(false)
  const fill = Math.max(0, Math.min(100, (value / 180) * 100))
  useEffect(() => {
    if (value >= previousValue.current) {
      previousValue.current = value
      return
    }
    setDrainDelta(previousValue.current - value)
    previousValue.current = value
    setDraining(true)
    const timer = window.setTimeout(() => setDraining(false), 950)
    return () => window.clearTimeout(timer)
  }, [value])
  return <motion.span className="recovered-jar" aria-label={`${value} minutes recovered`} animate={!reduceMotion ? { rotate: value < 120 ? [0, -5, 5, 0] : [0, 2, -2, 0] } : undefined} transition={{ duration: 0.55 }}>
    <span className="jar-neck" /><span className="jar-glass"><motion.i animate={{ height: `${fill}%` }} transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 80, damping: 18 }} /><span className="jar-glint" /></span><span className="jar-base" />
    <AnimatePresence>{draining && !reduceMotion && <motion.span className="jar-drain" initial={{ opacity: 0, y: -3 }} animate={{ opacity: [0, 1, 0], y: [0, 12, 21] }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>−{drainDelta}</motion.span>}</AnimatePresence>
  </motion.span>
}

export function TypedLine({ text, active }: { text: string; active: boolean }) {
  const reduceMotion = useReducedMotion()
  const words = text.split(/(\s+)/)
  return <>
    <span className="sr-only">{text}</span>
    <span className="typed-line" aria-hidden="true">{words.map((word, index) => <motion.span key={`${index}-${word}-${active}`} initial={active && !reduceMotion ? { opacity: 0, y: 3 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: active && !reduceMotion ? Math.min(index * 0.035, 0.7) : 0 }}>{word}</motion.span>)}</span>
  </>
}
