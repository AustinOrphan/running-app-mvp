// The words of the "start by" clock on the sheet of a night session (rule H6, NS1). A fact and its
// reason, no target and no verdict; `NIGHT_START_TEMPLATES` is spread into `TEMPLATES`. The clock
// comes from `nightStartBy` (`shared/engine/nightStart.ts`).
import type { NightStart } from '../engine/nightStart.ts'
import { render, tpl, type Template } from './template.ts'

export const NIGHT_START_TEMPLATES = {
  'night-start.by': tpl('Start by {clock}', { clock: 'text' }, { shape: 'label' }),
  'night-start.at': tpl('Start at {clock}', { clock: 'text' }, { shape: 'label' }),
  'night-start.reason': tpl('So the last {dark} are after dusk at home, which falls at {dusk}.', {
    dark: 'text',
    dusk: 'text',
  }),
  'night-start.reason-short': tpl(
    'The session is no longer than {dark}, so all of it is after dusk at home, which falls at {dusk}.',
    { dark: 'text', dusk: 'text' },
  ),
  'night-start.no-dusk': tpl(
    'The sun does not set far enough at the home place on this date, so there is no start time.',
  ),
  'night-start.no-home': tpl('The start time needs the home place on Profile.'),
  'night-start.link': tpl('Set the home place', {}, { shape: 'label' }),
} satisfies Record<string, Template>

/** The clock of a minute of the day, 24-hour ("18:42"), as the race clocks read. */
export function clockOfMinute(minute: number): string {
  const hh = String(Math.floor(minute / 60)).padStart(2, '0')
  const mm = String(minute % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/** The label of the clock, its reason line, or the line that says why there is no clock. */
export interface NightStartText {
  label: string | null
  line: string
}

/** The words for a start-by result; `null` as the result is a runner with no home place. */
export function nightStartText(start: NightStart | null): NightStartText {
  if (start === null) {
    return { label: null, line: render(NIGHT_START_TEMPLATES['night-start.no-home'], {}, 'km') }
  }
  if (start.kind === 'no-dusk') {
    return { label: null, line: render(NIGHT_START_TEMPLATES['night-start.no-dusk'], {}, 'km') }
  }
  const slots = {
    dark: `${String(start.darkMin)} min`,
    dusk: clockOfMinute(start.duskMin),
  }
  const clock = { clock: clockOfMinute(start.startMin) }
  return {
    label: render(
      NIGHT_START_TEMPLATES[start.allDark ? 'night-start.at' : 'night-start.by'],
      clock,
      'km',
    ),
    line: render(
      NIGHT_START_TEMPLATES[start.allDark ? 'night-start.reason-short' : 'night-start.reason'],
      slots,
      'km',
    ),
  }
}

/** The label of the link to Profile that goes with the no-home line. */
export function nightStartLinkText(): string {
  return render(NIGHT_START_TEMPLATES['night-start.link'], {}, 'km')
}
