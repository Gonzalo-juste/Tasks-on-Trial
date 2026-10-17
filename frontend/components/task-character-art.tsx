"use client"

import { motion, useReducedMotion } from "framer-motion"
import type { Archetype } from "@/lib/types"

type CharacterState = "idle" | "walking" | "speaking" | "nervous" | "hit" | "celebrating" | "sitting"
type CharacterProps = { archetype: Archetype; state?: CharacterState; variant?: "defendant" | "on-duty"; prisonerNumber?: number; label?: string; onClick?: () => void; compact?: boolean }

const colors: Record<Archetype, { fill: string; accent: string }> = {
  dumbbell: { fill: "#bf6d50", accent: "#e3b85d" }, envelope: { fill: "#e1c986", accent: "#9e5144" },
  book: { fill: "#668d78", accent: "#e7c65f" }, slides: { fill: "#597890", accent: "#d5a958" },
  phone: { fill: "#a07b9b", accent: "#edb85d" }, broom: { fill: "#bc8d47", accent: "#47715c" },
  cart: { fill: "#71989a", accent: "#d06c51" }, briefcase: { fill: "#795c4c", accent: "#d7ae56" },
  heart: { fill: "#c46c69", accent: "#6e8a78" }, note: { fill: "#d8b95c", accent: "#648092" },
  runner: { fill: "#3f9bd1", accent: "#f2b134" },
}

function CharacterDrawing({ archetype, color, accent }: { archetype: Archetype; color: string; accent: string }) {
  const common = { stroke: "#263844", strokeWidth: 3.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  switch (archetype) {
    case "dumbbell": return <>
      <path d="M48 67 Q26 48 20 65 L13 77 M92 67 Q114 48 120 65 L127 77" fill="none" {...common} />
      <path d="M45 69 Q70 58 95 69 L102 111 Q70 126 38 111Z" fill={color} {...common} />
      <rect x="53" y="18" width="34" height="13" rx="6" fill={accent} {...common} /><rect x="45" y="12" width="10" height="25" rx="4" fill={color} {...common} /><rect x="85" y="12" width="10" height="25" rx="4" fill={color} {...common} />
      <path d="M52 88 Q70 78 88 88 M52 98 Q70 108 88 98" fill="none" {...common} />
      <path d="M47 113 L44 135 M93 113 L96 135" fill="none" {...common} /><path d="M35 137h16 M88 137h17" {...common} />
      <path d="M19 78l-6 12 M127 78l6 12" fill="none" {...common} />
    </>
    case "runner": return <>
      {/* A running shoe mid-stride: headband, laces for a face, speed lines behind. */}
      <path d="M8 62h18 M4 76h20 M10 90h16" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" />
      <path d="M34 88 Q36 52 62 50 L84 50 Q92 66 112 74 Q128 80 126 96 L126 104 L34 104Z" fill={color} {...common} />
      <path d="M34 104h92 v8 Q80 120 34 112Z" fill="#f6f0e4" {...common} />
      <path d="M60 50 Q62 40 72 38 Q84 38 86 50" fill="none" stroke={accent} strokeWidth="6" strokeLinecap="round" />
      <path d="M70 62l16 6 M66 70l18 6 M62 78l20 6" fill="none" stroke="#f6f0e4" strokeWidth="3" strokeLinecap="round" />
      <circle cx="52" cy="70" r="3" fill="#263844" /><circle cx="60" cy="66" r="3" fill="#263844" /><path d="M48 80q8 6 16 0" fill="none" {...common} />
      <path d="M56 112 L44 132 L30 136 M96 114 L112 128 L126 124" fill="none" {...common} />
    </>
    case "envelope": return <>
      <path d="M22 54 Q70 43 118 54 L113 108 Q70 119 27 108Z" fill={color} {...common} />
      <path d="M24 57 L70 87 L116 57 M27 106 L57 80 M113 106 L83 80" fill="none" {...common} />
      <circle cx="70" cy="78" r="12" fill={accent} {...common} /><path d="M65 81 Q70 75 75 81" fill="none" {...common} />
      <path d="M43 109l-3 24 M96 109l4 24 M35 134h12 M96 134h12" fill="none" {...common} />
      <circle cx="58" cy="67" r="2" fill="#263844" /><circle cx="82" cy="67" r="2" fill="#263844" />
    </>
    case "book": return <>
      <path d="M27 23 Q50 15 70 28 Q90 15 113 23 L113 111 Q90 105 70 118 Q50 105 27 111Z" fill={color} {...common} />
      <path d="M70 29v87 M36 38 Q52 34 62 40 M78 40 Q93 34 104 38" fill="none" stroke="#f9f2e2" strokeWidth="2" />
      <circle cx="56" cy="57" r="10" fill="#fff8e9" {...common} /><circle cx="84" cy="57" r="10" fill="#fff8e9" {...common} /><path d="M66 56h8 M51 57h2 M83 57h2" fill="none" {...common} />
      <path d="M67 95 Q72 86 78 95 L78 129 L72 122 L67 129Z" fill={accent} {...common} />
      <path d="M39 112l-3 21 M101 112l3 21 M31 134h11 M98 134h11" fill="none" {...common} />
    </>
    case "slides": return <>
      <path d="M25 21h90v65H25Z" fill={color} {...common} /><path d="M36 34h55 M36 45h66 M36 57h43 M70 86v34 M70 120L50 139 M70 120l20 19" fill="none" stroke="#f7f1e4" strokeWidth="3" strokeLinecap="round" />
      <path d="M35 139h30 M82 139h22" {...common} /><path d="M105 63l15-27 M120 36l-5 1" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" />
      <circle cx="53" cy="61" r="2.5" fill="#263844" /><circle cx="81" cy="61" r="2.5" fill="#263844" /><path d="M61 71q7 6 14 0" fill="none" {...common} />
    </>
    case "phone": return <>
      <rect x="42" y="16" width="56" height="100" rx="13" fill={color} {...common} /><rect x="48" y="26" width="44" height="76" rx="7" fill="#f6f0e4" stroke="#263844" strokeWidth="2" />
      <circle cx="70" cy="57" r="11" fill={accent} /><path d="M59 79 Q70 65 81 79" fill={color} {...common} />
      <circle cx="99" cy="19" r="13" fill="#c14f47" {...common} /><path d="M99 12v8 M99 25v.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M39 81 Q23 69 18 81 Q17 91 39 99 M101 81 Q117 69 122 81 Q123 91 101 99" fill={accent} {...common} />
      <path d="M53 116l-4 18 M87 116l4 18 M44 136h12 M84 136h12" fill="none" {...common} />
    </>
    case "broom": return <>
      <path d="M75 19L61 111" stroke="#765936" strokeWidth="8" strokeLinecap="round" /><path d="M58 104 Q72 111 89 103 L104 126 Q75 143 42 126Z" fill={color} {...common} />
      <path d="M50 113l-6 13 M61 115l-4 16 M73 116v16 M84 114l4 15 M95 111l8 14" stroke="#263844" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M46 71 Q35 58 29 72 M97 71 Q108 58 114 72" fill="none" {...common} /><circle cx="61" cy="61" r="3" fill="#263844" /><circle cx="85" cy="61" r="3" fill="#263844" />
      <path d="M62 74q11 7 22 0" fill="none" stroke={accent} strokeWidth="7" strokeLinecap="round" />
      <path d="M47 126l-7 12 M99 126l7 12 M34 139h12 M101 139h12" fill="none" {...common} />
    </>
    case "cart": return <>
      <path d="M28 37h16l10 59h55l13-42H50" fill="none" stroke="#263844" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M53 58h62l-8 29H58Z" fill={color} {...common} /><path d="M63 62l2 20 M82 62v20 M101 62l-3 20" stroke="#f8f2e5" strokeWidth="2" />
      <circle cx="67" cy="112" r="11" fill={accent} {...common} /><circle cx="103" cy="112" r="11" fill={accent} {...common} />
      <path d="M108 56 Q119 43 125 51 L116 64" fill="none" {...common} /><circle cx="75" cy="48" r="2.5" fill="#263844" /><circle cx="91" cy="48" r="2.5" fill="#263844" /><path d="M80 54q7 5 14 0" fill="none" {...common} />
    </>
    case "briefcase": return <>
      <path d="M37 52h66q8 0 8 9v51H29V61q0-9 8-9Z" fill={color} {...common} /><path d="M55 51V38q0-7 8-7h15q8 0 8 7v13" fill="none" {...common} />
      <path d="M70 64l-12 13 12 28 12-28Z" fill={accent} {...common} /><circle cx="57" cy="59" r="2.5" fill="#263844" /><circle cx="84" cy="59" r="2.5" fill="#263844" />
      <path d="M31 78h80 M43 112l-3 23 M97 112l3 23 M34 136h12 M96 136h12" fill="none" {...common} />
      <rect x="66" y="80" width="9" height="7" rx="2" fill="#263844" />
    </>
    case "heart": return <>
      <path d="M70 116 Q22 84 31 49 Q38 22 63 40 Q70 46 70 51 Q83 23 107 39 Q132 59 105 88Z" fill={color} {...common} />
      <path d="M41 66 Q52 73 68 67 M76 67 Q91 73 101 65" fill="none" {...common} /><circle cx="54" cy="60" r="2.5" fill="#263844" /><circle cx="88" cy="60" r="2.5" fill="#263844" />
      <path d="M41 84 Q70 99 99 82 L94 96 Q70 108 47 95Z" fill={accent} {...common} />
      <path d="M54 112l-4 22 M87 112l4 22 M44 136h13 M85 136h13" fill="none" {...common} />
    </>
    default: return <>
      <path d="M32 28h77v82H32Z" fill={color} {...common} /><path d="M87 28v19h22" fill="#f3e7bc" {...common} />
      <circle cx="55" cy="66" r="3" fill="#263844" /><circle cx="84" cy="66" r="3" fill="#263844" /><path d="M57 82q13 11 26 0" fill="none" {...common} />
      <path d="M49 109l-4 25 M94 109l4 25 M39 137h13 M92 137h13" fill="none" {...common} />
      <path d="M50 52q5-5 10 0 M79 52q5-5 10 0" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" />
    </>
  }
}

export function TaskCharacter({ archetype, state = "idle", variant = "defendant", prisonerNumber, label, onClick, compact = false }: CharacterProps) {
  const reduceMotion = useReducedMotion()
  const animate = reduceMotion ? {} : {
    idle: { y: [0, -3, 0], rotate: [0, 1, 0] },
    walking: { x: [0, 2, 4], y: [0, -5, 0], rotate: [0, -2, 0] },
    speaking: { scale: [1, 1.045, 1] },
    nervous: { x: [0, -3, 3, -2, 0], rotate: [0, 2, -2, 1, 0] },
    hit: { x: [0, 18, -6, 0], rotate: [0, 13, -4, 0] },
    celebrating: { y: [0, -15, 0, -7, 0], rotate: [0, -5, 5, 0] },
    sitting: { y: [0, 6, 6], scaleY: [1, 0.92, 0.92] },
  }[state]
  const colorsForTask = colors[archetype]
  const className = `docket-character ${compact ? "docket-character-compact" : ""} ${variant === "defendant" ? "is-defendant" : "is-on-duty"}`
  const ariaLabel = label ?? `${archetype} task character${variant === "defendant" ? `, prisoner ${prisonerNumber ?? "unassigned"}` : ", on duty"}`
  const transition = { duration: state === "nervous" || state === "hit" ? 0.42 : state === "walking" ? 0.72 : state === "celebrating" ? 0.8 : 2.2, repeat: state === "idle" || state === "walking" ? Infinity : 0, ease: "easeInOut" as const }
  const drawing = <>
    {variant === "defendant" && prisonerNumber !== undefined && <span className="prisoner-tag">#{String(prisonerNumber).padStart(2, "0")}</span>}
    <svg viewBox="0 0 140 150" role="img" aria-hidden="true" className="character-illustration"><CharacterDrawing archetype={archetype} color={colorsForTask.fill} accent={colorsForTask.accent} />
      {state === "nervous" && <g className="sweat-drops" fill="#77a9bd"><path d="M119 33q-8 10 0 13q8-3 0-13"/><path d="M17 44q-7 9 0 12q7-3 0-12"/></g>}
      {variant === "on-duty" && <g className="duty-clipboard"><path d="M102 97h29v37h-29z" fill="#f6efdd" stroke="#263844" strokeWidth="2.5"/><path d="M108 106h16M108 114h16M108 122h11" stroke="#668d78" strokeWidth="2" strokeLinecap="round"/><path d="M110 94q0-5 6-5t6 5" fill="none" stroke="#263844" strokeWidth="2.5"/></g>}
    </svg>
  </>
  return onClick
    ? <motion.button type="button" className={className} aria-label={ariaLabel} onClick={onClick} animate={animate} transition={transition}>{drawing}</motion.button>
    : <motion.div className={className} role="img" aria-label={ariaLabel} animate={animate} transition={transition}>{drawing}</motion.div>
}

export function JudgeCharacter({ striking = false }: { striking?: boolean }) {
  const reduceMotion = useReducedMotion()
  return <motion.div className="court-judge" role="img" aria-label="The Honourable Day, presiding judge" animate={!reduceMotion && striking ? { rotate: [0, -5, 4, 0], y: [0, 4, -2, 0] } : undefined} transition={{ duration: 0.45 }}>
    <svg viewBox="0 0 150 155" aria-hidden="true"><path d="M20 116h110v26H20z" fill="#80583b" stroke="#302b29" strokeWidth="4"/><path d="M33 101h84v20H33z" fill="#c79d57" stroke="#302b29" strokeWidth="3"/><path d="M49 57q-1-27 26-28q27 1 26 28v29H49Z" fill="#f1cba4" stroke="#302b29" strokeWidth="3"/><path d="M45 58q-8-15-1-30l16 10q12-20 26-1l16-10q10 18-2 32" fill="#e8e1d4" stroke="#302b29" strokeWidth="3"/><circle cx="65" cy="61" r="3"/><circle cx="85" cy="61" r="3"/><path d="M66 75q9 8 18 0" fill="none" stroke="#302b29" strokeWidth="3" strokeLinecap="round"/><path d="M48 93q27-18 54 0l14 22H34Z" fill="#263b4a" stroke="#302b29" strokeWidth="3"/><motion.g style={{ transformOrigin: "104px 74px" }} animate={!reduceMotion && striking ? { rotate: [0, -38, 22, 0] } : { rotate: 0 }} transition={{ duration: 0.45 }}><path d="M98 94 Q108 84 104 74" fill="none" stroke="#263b4a" strokeWidth="10" strokeLinecap="round"/><path d="M104 73l25-8" stroke="#3b2414" strokeWidth="5" strokeLinecap="round"/><path d="M123 54l16 7-7 16-16-7z" fill="#4a2c1a" stroke="#302b29" strokeWidth="3"/><path d="M127 61l9 4 M124 68l9 4" stroke="#e8c77f" strokeWidth="3" strokeLinecap="round"/><circle cx="104" cy="74" r="5.5" fill="#f1cba4" stroke="#302b29" strokeWidth="2.5"/></motion.g></svg>
    <span>THE HONOURABLE DAY</span>
  </motion.div>
}

export function ProsecutorCharacter({ objecting = false }: { objecting?: boolean }) {
  const reduceMotion = useReducedMotion()
  return <motion.div className="court-prosecutor" role="img" aria-label="The prosecutor" animate={!reduceMotion && objecting ? { y: [0, -13, 0], rotate: [0, -4, 2, 0] } : undefined} transition={{ duration: 0.48 }}><svg viewBox="0 0 115 145" aria-hidden="true"><path d="M20 122q7-43 35-43t40 43v10H20Z" fill="#263b4a" stroke="#302b29" strokeWidth="3"/><path d="M39 49q0-25 18-25t18 25v22q-18 19-36 0Z" fill="#efc59d" stroke="#302b29" strokeWidth="3"/><path d="M36 48q-4-29 20-32q22 3 23 28l-13-8-12 6-15-2" fill="#49382f" stroke="#302b29" strokeWidth="3"/><circle cx="49" cy="51" r="2.5"/><circle cx="65" cy="51" r="2.5"/><path d="M49 63q8-5 16 0" fill="none" stroke="#302b29" strokeWidth="2.5"/><path d="M63 84l-9 24 14 0-4-24" fill="#ae5750" stroke="#302b29" strokeWidth="2.5"/><path d="M18 92L3 79 M89 92l17-32" stroke="#efc59d" strokeWidth="10" strokeLinecap="round"/><path d="M106 60l7-16" stroke="#efc59d" strokeWidth="6" strokeLinecap="round"/></svg><strong>{objecting ? "OBJECTION!" : "PROSECUTION"}</strong></motion.div>
}
