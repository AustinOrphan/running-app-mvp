// The month ticks shared by the charts of the Trends page: a weekly series of 26 to 104 weeks names
// its months, not its weeks. No chart library here, so a test can read it without loading one.

const monthName = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })

/**
 * The Mondays that carry an x tick: the first week of a calendar month, every `step` months from
 * January, so a 24-month range names eight months and not a hundred and four weeks.
 */
export function monthTicks(weekStarts: readonly string[], step: number): string[] {
  return weekStarts.filter((weekStart) => {
    const day = Number(weekStart.slice(8, 10))
    const month = Number(weekStart.slice(5, 7))
    // The Monday that opens a month is the first Monday on or after the 1st.
    return day <= 7 && (month - 1) % step === 0
  })
}

export function tickLabel(weekStart: string): string {
  const month = monthName.format(new Date(`${weekStart.slice(0, 7)}-01T00:00:00Z`))
  return weekStart.slice(5, 7) === '01' ? `${month} ${weekStart.slice(2, 4)}` : month
}

/** Months between ticks so that the labels of a phone-width chart do not touch. */
export function monthStep(weekCount: number): number {
  if (weekCount <= 30) return 1
  if (weekCount <= 60) return 2
  return 3
}
