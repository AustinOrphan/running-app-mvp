import { describe, expect, test } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { SESSION_STATUS_TEMPLATES, sessionStatusLabel } from '../../../shared/copy/sessionStatus.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { PlanSessionStatus } from '../../../shared/types.ts'

const LABELS: Record<PlanSessionStatus, string> = {
  planned: 'Planned',
  completed: 'Completed',
  partial: 'Partly done',
  skipped: 'Skipped',
  downgraded: 'Eased',
  moved: 'Moved',
  adjusted: 'Shortened',
}

describe('sessionStatusLabel', () => {
  test('words every status once, so every page reads the same', () => {
    for (const [status, label] of Object.entries(LABELS)) {
      expect(sessionStatusLabel(status as PlanSessionStatus), status).toBe(label)
    }
  })

  test('tells the engine-eased status from the shortened one', () => {
    expect(sessionStatusLabel('downgraded')).not.toBe(sessionStatusLabel('adjusted'))
  })

  test('the templates are in the registry the copy lint renders, and read clean', () => {
    for (const id of Object.keys(SESSION_STATUS_TEMPLATES)) expect(TEMPLATES, id).toHaveProperty(id)
    for (const label of Object.values(LABELS)) expect(lintText(label), label).toEqual([])
  })
})
