"use client"

import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { TaskCharacter } from "@/components/task-character-art"
import type { Archetype } from "@/lib/types"

export interface ScaleDefendant {
  id: string
  title: string
  archetype: Archetype
  minutes: number
}

interface JusticeScaleProps {
  grantedMinutes: number
  requestedMinutes: number
  impossible: boolean
  verdictLine: string
  defendants: ScaleDefendant[]
}

const MAX_TILT_DEG = 16

/** Tilt in degrees: positive sinks the tasks' pan (right), negative sinks your time (left). */
function tiltFor(granted: number, requested: number) {
  if (requested === 0) return -MAX_TILT_DEG * 0.6
  const ratio = (requested - granted) / Math.max(granted, 60)
  return Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, ratio * 22))
}

const hours = (minutes: number) => (minutes % 60 ? `${(minutes / 60).toFixed(1)}h` : `${minutes / 60}h`)

/**
 * The Docket's hero: your granted time on one pan, the tasks' demands on the other.
 * Every task that is filed drops onto its pan and the beam tips live.
 */
export function JusticeScale({ grantedMinutes, requestedMinutes, impossible, verdictLine, defendants }: JusticeScaleProps) {
  const reduceMotion = useReducedMotion()
  const tilt = tiltFor(grantedMinutes, requestedMinutes)
  const over = requestedMinutes > grantedMinutes
  const spring = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 70, damping: 9, mass: 1.2 }
  const sand = Math.min(100, (grantedMinutes / 480) * 100)
  return <aside className={`justice-scale ${over ? "is-over" : "is-balanced"} ${impossible ? "is-impossible" : ""}`} aria-label={`Scale of justice: ${grantedMinutes} minutes granted against ${requestedMinutes} minutes demanded`}>
    <div className="scale-heading"><span>THE SCALE OF THE DAY</span><strong>Your time <em>vs</em> their demands</strong></div>
    <div className="scale-rig">
      <div className="scale-pillar" aria-hidden="true"><span className="scale-finial">⚖</span></div>
      <motion.div className="scale-beam" animate={{ rotate: tilt }} transition={spring}>
        <div className="scale-pan pan-left">
          <motion.div className="pan-hang" animate={{ rotate: -tilt }} transition={spring}>
            <div className="pan-strings" aria-hidden="true" />
            <div className="pan-load hourglass-load">
              <div className="scale-hourglass" aria-hidden="true"><motion.i animate={{ height: `${sand}%` }} transition={{ duration: 0.5 }} /></div>
            </div>
            <div className="pan-dish" />
            <div className="pan-label"><strong>{hours(grantedMinutes)}</strong><span>your time</span></div>
          </motion.div>
        </div>
        <div className="scale-pan pan-right">
          <motion.div className="pan-hang" animate={{ rotate: -tilt }} transition={spring}>
            <div className="pan-strings" aria-hidden="true" />
            <div className="pan-load defendants-load">
              <AnimatePresence>{defendants.map((defendant, index) => <motion.div key={defendant.id} className="pan-defendant" title={`${defendant.title} · ${defendant.minutes} min`}
                initial={reduceMotion ? false : { y: -170, opacity: 0, rotate: -12 }} animate={{ y: 0, opacity: 1, rotate: 0 }} exit={{ y: -40, opacity: 0, scale: 0.6 }}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 16, delay: index * 0.12 }}>
                <TaskCharacter archetype={defendant.archetype} compact variant="defendant" prisonerNumber={index + 1} label={`${defendant.title}, ${defendant.minutes} minutes`} />
              </motion.div>)}</AnimatePresence>
              {defendants.length === 0 && <span className="pan-empty">No defendants yet</span>}
            </div>
            <div className="pan-dish" />
            <div className="pan-label"><strong>{requestedMinutes} min</strong><span>{defendants.length} {defendants.length === 1 ? "defendant" : "defendants"}</span></div>
          </motion.div>
        </div>
      </motion.div>
      <div className="scale-base" aria-hidden="true" />
    </div>
    <AnimatePresence mode="wait"><motion.p key={verdictLine} className="scale-verdict" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{verdictLine}</motion.p></AnimatePresence>
  </aside>
}
