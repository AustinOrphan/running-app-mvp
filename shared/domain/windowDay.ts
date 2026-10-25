// What the runner's windows say about the viewed day on Today (STATUS follow-up 19). A window is
// stated once, by the band: the band lists every window that is open, the verdict names what the day
// is, and the note and the signal that would state the same illness a second and third time stay
// out of the payload while the band holds it. Pure: the server builds the payload with it and the
// page reads the same set, so the two cannot disagree about which windows are open.
import type { IllnessGate } from '../engine/disruption.ts'
import type {
  DisruptionPhase,
  DisruptionView,
  ReadinessVerdict,
  TodayVerdict,
  WindowVerdictCode,
} from '../types.ts'

/**
 * The phases in which a window shapes the viewed day: it holds running, caps it, allows easy
 * running only, or limits the first week back. `upcoming` is a window still ahead, and `done` one
 * that is over.
 */
const OPEN_PHASES: ReadonlySet<DisruptionPhase> = new Set<DisruptionPhase>([
  'resting',
  'rest-gate',
  'limited',
  'easy-only',
  'returning',
])

/** Whether a window is open on the viewed day (its phase says so). */
export function isOpen(window: Pick<DisruptionView, 'phase'>): boolean {
  return OPEN_PHASES.has(window.phase)
}

/** The windows that are open on the viewed day, in the order given. */
export function openWindows<W extends Pick<DisruptionView, 'phase'>>(windows: readonly W[]): W[] {
  return windows.filter(isOpen)
}

/**
 * The windows the band lists: every one that is open, each on its own line, else the next one
 * ahead, else none. Windows overlap (an illness and an injury have their own dates), so the band
 * never stops at the first.
 */
export function bandWindows<W extends Pick<DisruptionView, 'phase'>>(windows: readonly W[]): W[] {
  const open = openWindows(windows)
  if (open.length > 0) return open
  const next = windows.find((window) => window.phase === 'upcoming')
  return next === undefined ? [] : [next]
}

/** What the open windows make of the day, strictest first: rest, limited running, easy, return. */
export type WindowDay = 'rest' | 'limited' | 'easy' | 'return'

const DAY_OF_PHASE: Partial<Record<DisruptionPhase, WindowDay>> = {
  resting: 'rest',
  'rest-gate': 'rest',
  limited: 'limited',
  'easy-only': 'easy',
  returning: 'return',
}

const DAY_ORDER: readonly WindowDay[] = ['rest', 'limited', 'easy', 'return']

/** The state of the day under the open windows, the strictest of them; null when none is open. */
export function windowDay(windows: readonly Pick<DisruptionView, 'phase'>[]): WindowDay | null {
  const days = new Set(windows.map((window) => DAY_OF_PHASE[window.phase]))
  return DAY_ORDER.find((day) => days.has(day)) ?? null
}

/** The sentence each state of the day is named by (`today.verdict.window-*`). */
const VERDICT_OF_DAY: Record<WindowDay, { code: WindowVerdictCode; template: string }> = {
  rest: { code: 'window-rest', template: 'today.verdict.window-rest' },
  limited: { code: 'window-limited', template: 'today.verdict.window-limited' },
  easy: { code: 'window-easy', template: 'today.verdict.window-easy' },
  return: { code: 'window-return', template: 'today.verdict.window-return' },
}

/**
 * The verdict of a day with a window open. "Ready as planned." beside a band that says the runner is
 * resting contradicts it, so that one verdict, and only that one, is replaced by the name of the
 * day's state. A verdict that already says something else (an easy run, a rest day, signals a
 * little low) stays: it is about the readings, not about the window.
 */
export function windowVerdict(
  verdict: ReadinessVerdict | null,
  windows: readonly Pick<DisruptionView, 'phase'>[],
): TodayVerdict | null {
  if (verdict === null || verdict.code !== 'ready') return verdict
  const day = windowDay(windows)
  if (day === null) return verdict
  return { ...VERDICT_OF_DAY[day], slots: {} }
}

/**
 * Whether the band already states the illness that the gate of rule n-3 holds the day under. The
 * note ("Illness was reported. Intensity is suspended...") and the signal ("Illness was reported:
 * rest until...") say what "Resting for illness until Tue 27 Oct." says, so they are left out of
 * the payload while the windows alone make the same gate as the windows and the check-ins together
 * (`windowGate`: `illnessGate` over the days of the illness windows only; `gate`: over every day
 * illness was reported or a window covers). A check-in that reports illness after the window's last
 * day moves the gate past what the band says, so the gate and the windows differ, and the note and
 * the signal stay: nothing else states that wait.
 */
export function bandOwnsIllness(gate: IllnessGate, windowGate: IllnessGate): boolean {
  return (
    gate.phase !== 'clear' && gate.phase === windowGate.phase && gate.since === windowGate.since
  )
}
