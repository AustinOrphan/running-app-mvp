// Words for the races the runner entered besides the goal race (rules K6 and H12, task SR1). The
// plan only plans around a race the runner entered: none of these lines suggests entering one (G5).

/** The purpose line of an entered race's session. */
export function enteredRacePurpose(args: {
  priority: 'B' | 'C'
  inTaper: boolean
  recovery: boolean
}): string {
  if (args.inTaper) {
    return 'A race you entered, inside the taper of the goal race. Run it by effort.'
  }
  const lead =
    args.priority === 'B'
      ? 'A race you entered. Run it by effort; the days before it are easy.'
      : 'A race you entered, kept light. Run it by effort; the day before it is easy.'
  return args.recovery ? `${lead} The days after it return to training in steps.` : lead
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
