import { describe, expect, it } from 'vitest'
import {
  LOAD_POSITIONS,
  LOAD_TEMPLATES,
  loadAgeRule,
  loadApplyLabel,
  loadCancelLabel,
  loadChangeLabel,
  loadHintLines,
  loadHoldReason,
  loadName,
  loadPanelText,
  loadSavedToast,
  loadSheetNote,
  loadSheetTitle,
  loadTradeoff,
  stepPercent,
} from '../../../shared/copy/load.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { ceilingWeeklyRate } from '../../../shared/engine/limits.ts'
import { positionStep, type LoadHold } from '../../../shared/engine/loadSetting.ts'
import { P } from '../../../shared/engine/params/index.ts'

const HOLDS: LoadHold[] = [
  'recent-injury',
  'bone-stress',
  'bsi-factors',
  'reds-hold',
  'bone-pain',
  'rest-window',
  'post-race',
  'low-frequency',
]

describe('the load setting copy', () => {
  it('registers every template, so the shared lint test renders them', () => {
    for (const id of Object.keys(LOAD_TEMPLATES)) {
      expect(id.startsWith('load.')).toBe(true)
      expect(id in TEMPLATES, id).toBe(true)
    }
  })

  it('names the three positions in the proposal words, none of them "safe" or "aggressive"', () => {
    expect(LOAD_POSITIONS.map(loadName)).toEqual(['Steady', 'Standard', 'Upper band'])
    const all = [
      ...LOAD_POSITIONS.flatMap((position) => [loadName(position), ...loadHintLines(position)]),
      loadAgeRule(),
      loadTradeoff(),
      ...HOLDS.map(loadHoldReason),
    ].join(' ')
    expect(all).not.toMatch(/\b(safe|safer|safest|aggressive)\b/i)
    expect(lintText(all)).toEqual([])
  })

  it('reads each position step from the Params, and the upper step from the hard ceiling', () => {
    expect(positionStep('steady')).toBe(P.g2.rampSoft.value)
    expect(positionStep('standard')).toBe(P.g8.stepStandard.value)
    expect(positionStep('upper')).toBe(ceilingWeeklyRate())
    // the largest step is the weekly rate at which two weeks meet the ceiling, never above it
    expect((1 + positionStep('upper')) ** 2 - 1).toBeCloseTo(P.g2.rampCeilingTwoWeeks.value, 10)
    expect(loadHintLines('steady')[0]).toBe("Adds up to 10% a week, the plan's usual step.")
    expect(loadHintLines('standard')[0]).toContain(
      `Adds up to ${String(Math.round(P.g8.stepStandard.value * 100))}% a week`,
    )
    expect(loadHintLines('upper')[0]).toContain('Adds up to 14% a week')
    expect(loadHintLines('upper')[0]).toContain('(30% over two weeks)')
    expect(loadAgeRule()).toBe(
      `At age ${String(P.a9.noviceFlagAgeMin.value)} or over, Upper band is held at Standard.`,
    )
  })

  it('states the response to weeks run above the plan at Standard and Upper band, not at Steady', () => {
    const response =
      'Weeks run above the plan raise the starting point of the next week, within the same limits.'
    expect(LOAD_TEMPLATES['load.hint.response'].text).toBe(response)
    expect(loadHintLines('steady')).not.toContain(response)
    for (const position of ['standard', 'upper'] as const) {
      const lines = loadHintLines(position)
      expect(lines, position).toContain(response)
      expect(lintText(lines.join(' ')), position).toEqual([])
      for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(COPY_MAX_CHARS)
    }
    // the panel on the Plan page reads the same hint as the form
    expect(
      loadPanelText({ requested: 'upper', position: 'upper', held: null, ageCapped: false }).hint,
    ).toEqual(loadHintLines('upper'))
  })

  it('reads a weekly step to one decimal everywhere: 14%, not 14.02%', () => {
    expect(stepPercent(positionStep('upper'))).toEqual({ kind: 'percent', pct: 14 })
    expect(stepPercent(0.12)).toEqual({ kind: 'percent', pct: 12 })
    expect(stepPercent(0.1253)).toEqual({ kind: 'percent', pct: 12.5 })
    expect(stepPercent(positionStep('steady'))).toEqual({ kind: 'percent', pct: 10 })
  })

  it('keeps every sentence of the trade-off within the length of a template', () => {
    const lines = loadTradeoff().split(/(?<=\.) /)
    expect(lines).toHaveLength(4)
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(COPY_MAX_CHARS)
    expect(loadTradeoff()).toMatch(/Staying with 10% is the more cautious choice\.$/)
  })

  it('has a reason for every hold the engine can name', () => {
    for (const hold of HOLDS) expect(loadHoldReason(hold), hold).not.toBe('')
    expect(loadHoldReason('bsi-factors')).toBe(
      'at least two risk factors for bone stress injury apply',
    )
    expect(loadHoldReason('low-frequency')).toBe('recent weeks held fewer than two runs a week')
  })

  it('words the action that changes the setting: the button, the sheet and the toast', () => {
    expect(loadChangeLabel()).toBe('Change')
    expect(loadSheetTitle()).toBe('Change load setting')
    expect(loadApplyLabel()).toBe('Apply')
    expect(loadCancelLabel()).toBe('Cancel')
    expect(loadSavedToast()).toBe('Load setting changed')
    const note = loadSheetNote()
    expect(note).toBe(
      'Applying draws the weeks ahead again with this setting. A change to the weeks can be undone from What changed.',
    )
    expect(note.length).toBeLessThanOrEqual(COPY_MAX_CHARS)
    const all = [
      loadChangeLabel(),
      loadSheetTitle(),
      loadApplyLabel(),
      loadCancelLabel(),
      loadSavedToast(),
      note,
    ].join(' ')
    expect(lintText(all)).toEqual([])
    expect(all).not.toMatch(/\b(safe|safer|safest|aggressive)\b/i)
  })

  it('words the panel from the payload: nothing to explain when the position applies', () => {
    const applies = loadPanelText({
      requested: 'standard',
      position: 'standard',
      held: null,
      ageCapped: false,
    })
    expect(applies.name).toBe('Standard')
    expect(applies.reason).toEqual([])

    expect(
      loadPanelText({
        requested: 'upper',
        position: 'steady',
        held: 'rest-window',
        ageCapped: false,
      }).reason,
    ).toEqual([
      'The plan was set to Upper band.',
      'The steady step applies for now: a rest window is active.',
    ])
    expect(
      loadPanelText({ requested: 'upper', position: 'standard', held: null, ageCapped: true })
        .reason,
    ).toEqual([
      'The plan was set to Upper band.',
      'The setting is held at Standard: age 45 or over.',
    ])
  })
})
