// Words for the races the runner entered besides the goal race (rules K6 and H12, task SR1). The
// plan only plans around a race the runner entered: none of these lines suggests entering one (G5).

/** The purpose line of an entered race's session. */
export function enteredRacePurpose(args: {
  priority: 'B' | 'C'
  inTaper: boolean
  /** `clipped`: the recovery window ends early, at the next race or the taper of the goal race. */
  recovery: 'none' | 'full' | 'clipped'
}): string {
  if (args.inTaper) {
    return 'A race you entered, inside the taper of the goal race. Run it by effort.'
  }
  const lead =
    args.priority === 'B'
      ? 'A race you entered. Run it by effort; the days before it are easy.'
      : 'A race you entered, kept light. Run it by effort; the day before it is easy.'
  if (args.recovery === 'full') return `${lead} The days after it return to training in steps.`
  if (args.recovery === 'clipped') {
    return `${lead} The days after it are eased until the next race or the taper.`
  }
  return lead
}

/** The title of an easy run the days before an entered race cut or eased. */
export const EASED_BEFORE_RACE_TITLE = 'Easy run before the race'

/** An entered race that falls in the taper of the goal race. */
export function raceInTaperWarning(name: string, date: string): string {
  return `The race ${name} on ${date} falls in the taper of the goal race. It stays as entered, and the taper is not eased further.`
}

/** An entered race that falls inside the recovery window of an earlier entered race. */
export function racesCloseWarning(args: {
  first: string
  firstDate: string
  second: string
  secondDate: string
}): string {
  return `The race ${args.second} on ${args.secondDate} falls inside the recovery after the race ${args.first} on ${args.firstDate}. Both stay as entered, and the recovery from the first ends at the second.`
}

/** The hold days of a window that ends early promise no date. */
export const CLIPPED_HOLD_PURPOSE = 'Rest. Walking and easy movement are fine.'

/** An entered race whose day holds a session the runner kept: the race is not drawn into the plan. */
export function raceOnKeptDayWarning(name: string, date: string): string {
  return `The race ${name} on ${date} is not drawn into the plan: the day holds a session kept earlier.`
}

/** An entered race the plan does not hold yet, whatever the cause; the Plan page shows it as a warning. */
export const RACE_NOT_IN_PLAN_WARNING =
  'A race you entered is not in the plan yet. The weekly update draws the plan again.'
