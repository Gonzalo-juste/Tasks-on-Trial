// Learns how long things really take. "Mark done" records actual minutes per archetype in this
// browser; the next quick capture scales its estimates and the trial receives the record as a fact.
import type { Archetype } from "./estimates"

const STORAGE_KEY = "tasks-on-trial.calibration.v1"
const MAX_RECORDS_PER_ARCHETYPE = 5

export interface DoneRecord {
  archetype: Archetype
  title: string
  planned_min: number
  actual_min: number
  at: string
}

function load(): DoneRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DoneRecord[]) : []
  } catch {
    return []
  }
}

function save(records: DoneRecord[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // Private mode or blocked storage: calibration simply stays empty.
  }
}

export function recordDone(record: Omit<DoneRecord, "at">) {
  if (record.planned_min <= 0 || record.actual_min <= 0) return
  const others = load().filter((r) => r.archetype !== record.archetype)
  const same = load().filter((r) => r.archetype === record.archetype)
  save([...others, ...[...same, { ...record, at: new Date().toISOString() }].slice(-MAX_RECORDS_PER_ARCHETYPE)])
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** actual / planned per archetype (median of the latest records), clamped to 0.5–2. */
export function calibrationRatios(): Partial<Record<Archetype, number>> {
  const byArchetype = new Map<Archetype, number[]>()
  for (const r of load()) byArchetype.set(r.archetype, [...(byArchetype.get(r.archetype) ?? []), r.actual_min / r.planned_min])
  return Object.fromEntries(
    [...byArchetype].map(([archetype, ratios]) => [archetype, Math.min(2, Math.max(0.5, median(ratios)))]),
  )
}

/** Evidence for the trial, e.g. "Last time, Go to the gym took 80 min (planned 60)." */
export function calibrationFact(archetype: Archetype): string | null {
  const last = load().filter((r) => r.archetype === archetype).at(-1)
  if (!last) return null
  return `Last time, ${last.title} took ${last.actual_min} min (planned ${last.planned_min})`
}

/** Demo only: a believable history so calibration is visible within a 3-minute pitch. */
export function seedDemoCalibration() {
  if (load().length) return
  save([
    { archetype: "dumbbell", title: "Go to the gym", planned_min: 60, actual_min: 80, at: "2026-10-16T19:00:00+01:00" },
    { archetype: "envelope", title: "Answer emails", planned_min: 30, actual_min: 20, at: "2026-10-16T10:00:00+01:00" },
  ])
}
