// The plan report (task H1, proposal section 5): the text is deterministic, every figure carries
// its grade and rule, the scorecard has no overall score, the bands say "D, practice source", and
// no G5 word appears. The matrix section is pinned by a digest, as the oracle pins the plans, and so
// is the section of each method preset (task M5): "D, a choice", the figures beside the default's.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PARAMS_VERSION } from '../../../shared/engine/index.ts'
import { SWEEP_COUNT, SWEEP_SEED, sweepCases } from '../engine/history-sweep.ts'
import { OFFERED, READING, type Offered } from '../engine/method-fixtures.ts'
import { BAND_LABEL } from '../../reports/bands.ts'
import {
  assertReportClean,
  fix,
  historyRows,
  lengthBucket,
  matrixRows,
  presetLabel,
  presetRows,
  renderHistorySection,
  renderMatrixSection,
  renderPresetSection,
  renderPresetsSection,
  renderReport,
  renderWindowSection,
  spread,
  startBucket,
  windowRows,
  yearsOfRunner,
} from '../../reports/plan-report.ts'

/**
 * The digest of the matrix section (the five tables, the bands and the twelve scorecards). It
 * moves with any change to a matrix plan, a Param that a figure is labelled with or the text of
 * the report, as the oracle digests move with the plans. When the move is intended, read the
 * change with `npm run plan:report -- --matrix-only` before and after, then regenerate:
 *
 *   npx tsx -e "import('./tests/reports/plan-report.ts').then(async (m) => {
 *     const { createHash } = await import('node:crypto')
 *     console.log(createHash('sha256').update(m.renderMatrixSection()).digest('hex'))
 *   })"
 */
const MATRIX_DIGEST = 'd306259c6f06b18f724218b76d81150dd44c6f48b2808a7f902498e57c8b4735'

/**
 * The digest of the section of each method preset (the twelve athletes at the preset, each figure
 * beside the default's with the change, and the two strata rows). It moves with a preset plan, the
 * Param a figure is labelled with, the reading of a preset or the text of the section; the digest of
 * the default's matrix above does not move with any of them. Regenerate with
 *
 *   npx tsx -e "import('./tests/reports/plan-report.ts').then(async (m) => {
 *     const { createHash } = await import('node:crypto')
 *     for (const method of ['three-run-days', 'longer-base'])
 *       console.log(method, createHash('sha256').update(m.renderPresetSection(method)).digest('hex'))
 *   })"
 */
const PRESET_DIGESTS: Record<Offered, string> = {
  'three-run-days': '8d50144935b29ce01f677669a6aad78ef0adc8732de01d53b5e1b10972c83dea',
  'longer-base': 'd6d7e33ea4d7d8a8a19c6af277720b043ec3eee88a1fa40714ba011a85328e20',
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** The cells of the table that follows `heading`, header row first, separator row left out. */
function tableAfter(text: string, heading: string): string[][] {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l === heading)
  if (start < 0) throw new Error(`no heading ${heading}`)
  const rows: string[][] = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('|'))
      rows.push(
        line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim()),
      )
    else if (rows.length > 0) break
  }
  return [rows[0]!, ...rows.slice(2)]
}

const matrix = renderMatrixSection()

describe('the matrix section', () => {
  it('is the same text twice, and its digest is the pinned one', () => {
    expect(renderMatrixSection()).toBe(matrix)
    expect(sha256(matrix), 'regenerate the digest as the comment above MATRIX_DIGEST says').toBe(
      MATRIX_DIGEST,
    )
  })

  it('holds one row for each of the twelve athletes in each of the four tables', () => {
    const ids = matrixRows().map((r) => r.id)
    expect(ids).toHaveLength(12)
    for (const heading of [
      '### Shape and steps',
      '### G-2 headroom',
      '### Composition',
      '### Load, recovery cycle and taper',
    ]) {
      const [, ...body] = tableAfter(matrix, heading)
      expect(
        body.map((r) => r[0]),
        heading,
      ).toEqual(ids)
    }
  })

  it('reproduces the measured table of the proposal (section 2.3)', () => {
    // weeks, peak minutes, first at highest, loading weeks within 5%, median step
    const proposal: Record<string, [number, number, number, string, number]> = {
      'novice-5k': [14, 90, 9, '1 of 11', 7.9],
      half: [20, 270, 5, '11 of 13', 0],
      marathon: [24, 330, 2, '14 of 14', 0],
      'trail-50k': [23, 390, 6, '11 of 14', 0],
      'first-100-mile': [34, 600, 9, '16 of 21', 0],
      masters: [21, 330, 8, '7 of 13', 3.1],
      returning: [21, 270, 14, '4 of 13', 9.6],
      'prior-bsi': [16, 203, 13, '2 of 9', 4.7],
      'hot-race': [29, 330, 6, '15 of 18', 0],
      'sparse-100-mile': [38, 600, 30, '3 of 24', 9.7],
      'reds-hold': [23, 285, 1, '14 of 14', 0],
      'post-marathon-short-run': [16, 99, 13, '1 of 13', 0],
    }
    const [head, ...body] = tableAfter(matrix, '### Shape and steps')
    const col = (name: string) => head!.findIndex((h) => h.startsWith(name))
    for (const row of body) {
      const [weeks, peak, first, within, step] = proposal[row[0]!]!
      expect(Number(row[col('Weeks')]), row[0]).toBe(weeks)
      expect(Number(row[col('Peak min')]), row[0]).toBe(peak)
      expect(Number(row[col('First at highest')]), row[0]).toBe(first)
      expect(row[col('Loading weeks within 5%')], row[0]).toBe(within)
      expect(parseFloat(row[col('Median step')]!), row[0]).toBeCloseTo(step, 5)
    }
  })

  it("labels each figure column with its figure's grade and rule, or 'no rule'", () => {
    const [shape] = tableAfter(matrix, '### Shape and steps')
    expect(shape).toContain('Median step (D, g-2)')
    expect(shape).toContain('Peak min (no rule)')
    const [headroom] = tableAfter(matrix, '### G-2 headroom')
    expect(headroom).toContain('Soft step, tightest headroom (min) (D, g-2)')
    expect(headroom).toContain('Two-week ceiling, tightest headroom (min) (C, g-2)')
    const [composition] = tableAfter(matrix, '### Composition')
    expect(composition).toContain('Long run share, mean (D, design-macro)')
    expect(composition).toContain('Declared Z1 / Z2 / Z3 % (C, E4)')
    const [load] = tableAfter(matrix, '### Load, recovery cycle and taper')
    expect(load).toContain('Taper weeks (B, K1, K2, K3)')
    expect(load).toContain('Monotony, mean (C, B7)')
    // every figure column of the four tables has a label; only the identifiers and Weeks do not
    const label = /\((?:no rule|[ABCD], [^;)]+)(?:; note \d)?\)$/
    for (const heading of [
      '### Shape and steps',
      '### G-2 headroom',
      '### Composition',
      '### Load, recovery cycle and taper',
    ]) {
      const unlabelled = tableAfter(matrix, heading)[0]!.filter((h) => !label.test(h))
      expect(unlabelled, heading).toEqual(
        heading === '### Shape and steps' ? ['Athlete', 'Goal', 'Weeks'] : ['Athlete'],
      )
    }
  })

  it('says why headroom reads negative, and that the first week is a part week', () => {
    const notes = renderReport({ matrixOnly: true })
    expect(notes).toContain('negative figure')
    expect(notes).toContain('novice minimum step')
    expect(notes).toContain('rebuild zone')
    expect(notes).toContain('part week')
    const [head, ...body] = tableAfter(matrix, '### G-2 headroom')
    const soft = head!.findIndex((h) => h.startsWith('Soft step'))
    const novice = body.find((r) => r[0] === 'novice-5k')!
    const post = body.find((r) => r[0] === 'post-marathon-short-run')!
    expect(Number(novice[soft])).toBeLessThan(0)
    expect(Number(post[soft])).toBeLessThan(0)
  })
})

describe('the preset sections', () => {
  const sections = new Map(OFFERED.map((m) => [m, renderPresetSection(m)] as const))

  it.each(OFFERED)('%s: is the same text twice, and its digest is the pinned one', (method) => {
    expect(renderPresetSection(method)).toBe(sections.get(method))
    expect(
      sha256(sections.get(method)!),
      'regenerate the digest as the comment above PRESET_DIGESTS says',
    ).toBe(PRESET_DIGESTS[method])
  })

  it('leaves the matrix section of the default as it was: the presets are a section of their own', () => {
    expect(sha256(renderMatrixSection())).toBe(MATRIX_DIGEST)
    const text = renderReport({ matrixOnly: true })
    expect(text.indexOf('## Matrix')).toBeLessThan(text.indexOf('## Presets'))
    expect(text.indexOf('## Scorecards: matrix')).toBeLessThan(text.indexOf('## Presets'))
  })

  it.each(OFFERED)(
    '%s: holds a row for each of the twelve athletes, then the two strata',
    (method) => {
      const [, ...body] = tableAfter(sections.get(method)!, `### ${method}: ${presetLabel(method)}`)
      expect(body.slice(0, 12).map((r) => r[0])).toEqual(matrixRows().map((r) => r.id))
      expect(body.slice(12).map((r) => r[0]!.replace(/ \(\d+ plans\).*/, ''))).toEqual([
        'Preset applies',
        'Preset reads the default',
      ])
      const counts = body.slice(12).map((r) => Number(/\((\d+) plans\)/.exec(r[0]!)![1]))
      expect(counts).toEqual(method === 'three-run-days' ? [3, 9] : [8, 4])
    },
  )

  it('labels every row "D, a choice" with the rule of the preset, read from the registry', () => {
    expect(presetLabel('three-run-days')).toBe('D, a choice (P2)')
    expect(presetLabel('longer-base')).toBe('D, a choice (P4)')
    for (const method of OFFERED) {
      const [head, ...body] = tableAfter(
        sections.get(method)!,
        `### ${method}: ${presetLabel(method)}`,
      )
      expect(head!.at(-1)).toBe('Label')
      for (const row of body) expect(row.at(-1), row[0]).toBe(presetLabel(method))
    }
  })

  it.each(OFFERED)('%s: reads each athlete as the table of the matrix tests does', (method) => {
    const rows = presetRows(method)
    for (const row of rows) {
      const want = READING[method][row.id]!
      const got = row.position.reason === null ? 'applies' : row.position.reason
      expect(got, row.id).toBe(want)
    }
  })

  it.each(OFFERED)('%s: shows no change for a runner the preset reads as the default', (method) => {
    const [head, ...body] = tableAfter(
      sections.get(method)!,
      `### ${method}: ${presetLabel(method)}`,
    )
    const figures = head!.slice(3, -1)
    let read = 0
    for (const row of body.slice(0, 12)) {
      if (!row[2]!.startsWith('reads the default')) continue
      read += 1
      for (const [i, cell] of row.slice(3, -1).entries()) {
        expect(cell, `${row[0]}: ${figures[i]}`).toMatch(/\((?:\+|-)?0(?:\.0)?\)$/)
      }
    }
    expect(read).toBe(method === 'three-run-days' ? 9 : 4)
  })

  it('shows the three-run-days cap and the longer-base shape as the change of the figures', () => {
    const find = (method: Offered, id: string) =>
      tableAfter(sections.get(method)!, `### ${method}: ${presetLabel(method)}`)
        .slice(1)
        .find((r) => r[0] === id)!
    const column = (method: Offered, name: string) =>
      tableAfter(sections.get(method)!, `### ${method}: ${presetLabel(method)}`)[0]!.findIndex(
        (h) => h.startsWith(name),
      )
    // the half marathon runs five days a week at the default and three at the preset
    expect(find('three-run-days', 'half')[column('three-run-days', 'Run days, max')]).toBe(
      '5 / 3 (-2)',
    )
    // two weeks of build become base, and the intervals of the default leave the build
    expect(find('longer-base', 'half')[column('longer-base', 'Base weeks')]).toBe('3 / 5 (+2)')
    expect(find('longer-base', 'half')[column('longer-base', 'Build weeks')]).toBe('6 / 4 (-2)')
    expect(find('longer-base', 'half')[column('longer-base', 'Interval sessions')]).toBe(
      '5 / 0 (-5)',
    )
    // no week plans more minutes than the default's, so no peak in minutes rises
    for (const method of OFFERED) {
      const peak = column(method, 'Peak min')
      for (const row of tableAfter(
        sections.get(method)!,
        `### ${method}: ${presetLabel(method)}`,
      ).slice(1, 13)) {
        expect(row[peak], `${method} ${row[0]}`).toMatch(/\((?:\+|-)?0\)$/)
      }
    }
  })

  it('has no G5 word and no word for safe', () => {
    expect(() => assertReportClean(renderPresetsSection())).not.toThrow()
    expect(renderPresetsSection()).toContain('a choice and not a better plan')
  })
})

describe('the scorecards', () => {
  const cards = matrix.split('\n### Scorecard: ').slice(1)

  it('are one block per plan with figure, value, grade and rule, and no overall score', () => {
    expect(cards).toHaveLength(12)
    for (const card of cards) {
      const lines = card.split('\n')
      const id = lines[0]!.split(' ')[0]
      const [head, , ...body] = lines
        .filter((l) => l.startsWith('|'))
        .map((l) =>
          l
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim()),
        )
      expect(head, id).toEqual(['Figure', 'Value', 'Grade', 'Rule'])
      expect(body.length, id).toBeGreaterThanOrEqual(15)
      for (const [figure, value, grade, rule] of body) {
        const where = `${id}: ${figure}`
        // a grade is A to D, or "-" for a figure with no rule
        expect(grade, where).toMatch(/^[ABCD-]$/)
        expect(rule, where).toBeTruthy()
        if (grade === '-') expect(rule, where).toBe('no rule')
        expect(`${figure} ${value}`.toLowerCase(), where).not.toMatch(
          /overall|score|acute|chronic|ratio/,
        )
      }
      expect(card).toContain('No overall score.')
    }
  })

  it('carry a Knopp row for each marathon plan and a programme row for each 5 and 10 km plan', () => {
    const rowsOf = (id: string) => cards.find((c) => c.startsWith(`${id} `))!
    for (const id of ['marathon', 'masters', 'hot-race']) {
      const card = rowsOf(id)
      for (const figure of [
        'Build-up',
        'Peak week, first',
        'Taper',
        'Final week',
        'Run days a week, mean',
      ]) {
        expect(card, `${id}: ${figure}`).toContain(figure)
      }
      expect(card).toContain('practice source: knopp-2024-marathon-plans')
    }
    expect(rowsOf('novice-5k')).toContain('Start ladder: week of the first continuous run')
    expect(rowsOf('novice-5k')).toContain('nhs-2026-couch-to-5k')
    expect(rowsOf('prior-bsi')).toContain('higdon-2024-advanced-10k')
    // a half marathon or an ultra has no band
    expect(rowsOf('half')).not.toContain('practice source')
    expect(rowsOf('first-100-mile')).not.toContain('practice source')
  })

  it("print every band row as 'D, practice source'", () => {
    const section = matrix.slice(
      matrix.indexOf('## Reference bands: matrix'),
      matrix.indexOf('## Scorecards: matrix'),
    )
    for (const heading of [
      '### Knopp et al. 2024: marathon plans, last 12 weeks',
      '### 5 and 10 km programme pages and the start ladder',
    ]) {
      const [head, ...body] = tableAfter(section, heading)
      expect(head!.at(-1), heading).toBe('Label')
      expect(body.length, heading).toBeGreaterThan(3)
      for (const row of body) expect(row.at(-1), `${heading}: ${row[0]}`).toBe(BAND_LABEL)
    }
    // the marathon table opens with the band itself
    const [, band] = tableAfter(section, '### Knopp et al. 2024: marathon plans, last 12 weeks')
    expect(band).toEqual([
      'band',
      '12',
      '5 to 9',
      '3.6 to 4.4',
      '3.6 to 4.4',
      '22 to 31',
      '46 to 54',
      '4.1 to 6.8',
      BAND_LABEL,
    ])
  })
})

describe('the sweeps', () => {
  it('read the years of running from the runner name, for every one of the 150 runners', () => {
    const years = sweepCases(SWEEP_SEED, SWEEP_COUNT).map((c) => yearsOfRunner(c.name))
    expect(new Set(years)).toEqual(new Set([1, 3]))
    expect(yearsOfRunner('#7 half 3y block 5x4x60 ended 9')).toBe(3)
  })

  it('bucket the starts of the windows by the days from today', () => {
    expect([-14, -1, 0, 6, 7, 14].map(startBucket)).toEqual([
      'before today',
      'before today',
      'in the first week',
      'in the first week',
      'in the second week',
      'in the second week',
    ])
  })

  it('bucket the window lengths of the sample', () => {
    expect([1, 2, 3, 4, 7, 8, 14, 15, 28].map(lengthBucket)).toEqual([
      '1 day',
      '2 to 3 days',
      '2 to 3 days',
      '4 to 7 days',
      '4 to 7 days',
      '8 to 14 days',
      '8 to 14 days',
      '15 to 28 days',
      '15 to 28 days',
    ])
  })

  const history = historyRows(6)
  const windows = windowRows(32)

  it('stratify every plan by the axes of the sweep, with none left out', () => {
    expect(history).toHaveLength(18)
    const text = renderHistorySection(history)
    const [, ...byKind] = tableAfter(text, '### By goal kind and load position')
    expect(byKind.reduce((sum, r) => sum + Number(r[1]), 0)).toBe(18)
    const [, ...byYears] = tableAfter(text, '### By years of running')
    expect(byYears.reduce((sum, r) => sum + Number(r[1]), 0)).toBe(18)
    const wtext = renderWindowSection(windows)
    expect(windows).toHaveLength(32)
    const [, ...byReason] = tableAfter(wtext, '### By reason and mode')
    expect(byReason.reduce((sum, r) => sum + Number(r[1]), 0)).toBe(32)
    const [, ...byLength] = tableAfter(wtext, '### By length of the window')
    expect(byLength.reduce((sum, r) => sum + Number(r[1]), 0)).toBe(32)
    const [, ...byStart] = tableAfter(wtext, '### By start of the window')
    expect(byStart.reduce((sum, r) => sum + Number(r[1]), 0)).toBe(32)
  })

  it('gives the same text twice for the same sample', () => {
    expect(renderReport({ history: 4, windows: 16 })).toBe(
      renderReport({ history: 4, windows: 16 }),
    )
  })

  it('leaves the sweeps out of a matrix-only report, and puts them in otherwise', () => {
    const text = renderReport({ matrixOnly: true })
    expect(text).toContain('## Matrix: twelve athletes')
    expect(text).not.toContain('## History sweep')
    expect(text).not.toContain('## Rest-window sweep')
    const full = renderReport({ matrixOnly: false, history: 2, windows: 8 })
    expect(full).toContain('## History sweep: 2 runners')
    expect(full).toContain('## Rest-window sweep: 8 plans')
    expect(full.startsWith(text.slice(0, text.indexOf('## Matrix')))).toBe(true)
  })

  it('opens with the Params version and says that it is report only', () => {
    const text = renderReport({ matrixOnly: true })
    expect(text).toContain(`Params version ${PARAMS_VERSION}.`)
    expect(text.split('\n').slice(0, 3).join(' ')).toContain('Report only.')
  })
})

describe('the words of the report', () => {
  it('has none of the G5 words and no word for safe', () => {
    expect(() => assertReportClean(renderReport({ history: 4, windows: 16 }))).not.toThrow()
  })

  it('refuses safe, behind, missed and streak, and the rest of the G5 lint', () => {
    for (const word of [
      'safe',
      'unsafe',
      'Safety',
      'behind plan',
      'missed week',
      'streak',
      'failed',
    ]) {
      expect(() => assertReportClean(`A week that is ${word}.`), word).toThrow()
    }
    expect(() => assertReportClean('A plain sentence about steps and headroom.')).not.toThrow()
  })
})

describe('number formatting', () => {
  it('never prints a negative zero', () => {
    expect(fix(-0.04)).toBe('0.0')
    expect(fix(-0.4, 0)).toBe('0')
    expect(fix(-0.4)).toBe('-0.4')
    expect(fix(12.345, 2)).toBe('12.35')
  })

  it('gives the median and the range of the values that exist, and counts the ones that do not', () => {
    const whole = (n: number) => fix(n, 0)
    expect(spread([3, 1, 2], whole)).toBe('2 (1 to 3)')
    expect(spread([4, 2], whole)).toBe('3 (2 to 4)')
    expect(spread([1, null, 5], whole)).toBe('3 (1 to 5) [2 of 3]')
    expect(spread([null, null], whole)).toBe('n/a')
    // the median, not the mean
    expect(spread([1, 2, 9], whole)).toBe('2 (1 to 9)')
  })
})
