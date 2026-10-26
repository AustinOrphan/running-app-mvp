import { todayIso } from '../../shared/dates.ts'

/**
 * How long a run needs the calendar day to hold. Every spec works out its dates from the clock
 * when it starts (`relativeDates()`), and the server and the page derive "today" from the same
 * clock, so a run that crosses local midnight leaves a spec with Sunday's plan, check-ins and
 * queued writes on a page that now shows Monday. CI hit it on 2026-10-25 at 00:00:00 UTC, with
 * `12-today.spec.ts` reloading a page whose queued check-in belonged to the day before. The suite
 * takes about a minute on CI; this is three times that, for a slower machine.
 */
export const DAY_HOLDS_MS = 3 * 60_000

/** How often the clock is read while the run waits for the next day. */
const POLL_MS = 250

/** Milliseconds from `now` to the next local midnight (23 or 25 hours away on a clock-change day). */
export function msUntilMidnight(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
}

/**
 * Returns at once when the local day holds for `holdMs` more. Otherwise it returns once the local
 * date has changed: it waits for that change, not for a guessed time. A clock that never reaches
 * the next day (set back by hand) ends the wait a minute after the expected midnight instead of
 * hanging the run.
 */
export async function waitForNextDay(holdMs: number = DAY_HOLDS_MS): Promise<void> {
  const start = new Date()
  const left = msUntilMidnight(start)
  if (left >= holdMs) return
  const day = todayIso(start)
  const giveUpAt = start.getTime() + left + 60_000
  console.log(`e2e: ${String(Math.ceil(left / 1000))} s to midnight, waiting for ${day} to end.`)
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (todayIso() !== day || Date.now() >= giveUpAt) {
        clearInterval(timer)
        resolve()
      }
    }, POLL_MS)
  })
}

/** Playwright's global setup (`globalSetup` in `playwright.config.ts`). */
export default async function globalSetup(): Promise<void> {
  await waitForNextDay()
}
