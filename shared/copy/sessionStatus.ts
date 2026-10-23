// The word for a planned session's status, wherever a page names one: the Today hero chip, the
// session sheet, the Plan table and the Review list. One map, so a status reads the same on every
// page. `downgraded` is a session the engine eased and `adjusted` one the runner shortened, so the
// two words differ on purpose.
import type { PlanSessionStatus, Units } from '../types.ts'
import { render, tpl, type Template } from './template.ts'

export const SESSION_STATUS_TEMPLATES = {
  'session-status.planned': tpl('Planned', {}, { shape: 'label' }),
  'session-status.completed': tpl('Completed', {}, { shape: 'label' }),
  'session-status.partial': tpl('Partly done', {}, { shape: 'label' }),
  'session-status.skipped': tpl('Skipped', {}, { shape: 'label' }),
  'session-status.downgraded': tpl('Eased', {}, { shape: 'label' }),
  'session-status.moved': tpl('Moved', {}, { shape: 'label' }),
  'session-status.adjusted': tpl('Shortened', {}, { shape: 'label' }),
} satisfies Record<string, Template>

const STATUS_IDS = {
  planned: 'session-status.planned',
  completed: 'session-status.completed',
  partial: 'session-status.partial',
  skipped: 'session-status.skipped',
  downgraded: 'session-status.downgraded',
  moved: 'session-status.moved',
  adjusted: 'session-status.adjusted',
} as const satisfies Record<PlanSessionStatus, keyof typeof SESSION_STATUS_TEMPLATES>

/** The words read the same in either unit system. */
const UNITS: Units = 'km'

/** "Planned", "Eased", "Shortened": the status of a plan session as the runner reads it. */
export function sessionStatusLabel(status: PlanSessionStatus): string {
  return render(SESSION_STATUS_TEMPLATES[STATUS_IDS[status]], {}, UNITS)
}
