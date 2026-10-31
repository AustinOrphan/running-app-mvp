import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  defaultGrade,
  longRunShare,
  METHOD_TEMPLATES,
  methodReasonText,
  openDaysOf,
  overrideGrade,
  PLAN_SHAPES,
  planShapeFitNote,
  planShapeGradeLine,
  planShapeHeldLine,
  planShapeHelp,
  planShapeHold,
  planShapeLabel,
  planShapeNotFor,
  planShapeOffered,
  planShapePanelText,
  planShapeRows,
  planShapeWhyRules,
  presetGrade,
  presetRule,
} from '../../../shared/copy/method.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { PersistentHold } from '../../../shared/engine/holds.ts'
import {
  effective,
  type MethodPosition,
  type MethodReason,
} from '../../../shared/engine/methods.ts'
import { QUALITY_BY_PRESET } from '../../../shared/engine/micro.ts'
import { allParams, P } from '../../../shared/engine/params/index.ts'
import { PRESET_OVERRIDES } from '../../../shared/engine/params/p-methods.ts'
import type { Availability, Weekday } from '../../../shared/types.ts'

const DAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** An availability with the first `open` days marked available. */
function availability(open: number): Availability {
  return Object.fromEntries(
    DAYS.map((day, index) => [day, { available: index < open, maxMin: null }]),
  ) as Availability
}

const HOLDS: readonly PersistentHold[] = [
  'recent-injury',
  'bone-stress',
  'bsi-factors',
  'reds-hold',
  'bone-pain',
]

const position = (over: Partial<MethodPosition> = {}): MethodPosition => ({
  requested: 'default',
  effective: 'default',
  reason: null,
  ...over,
})

/** Every sentence the page and the drawer can show for the shapes, to read for wording. */
function allSentences(): string[] {
  const reasons: MethodReason[] = [
    'not-applicable',
    'novice',
    'no-base',
    ...HOLDS.map((hold): MethodReason => `held:${hold}`),
  ]
  return [
    ...PLAN_SHAPES.flatMap((shape) => [planShapeLabel(shape), planShapeHelp(shape)]),
    planShapeGradeLine(),
    planShapeNotFor(),
    ...[0, 1, 2, 3, 4, 5, 7].map((open) => planShapeFitNote('three-run-days', open) ?? ''),
    ...HOLDS.map(planShapeHeldLine),
    ...reasons.map(methodReasonText),
    ...reasons.flatMap((reason) => {
      const text = planShapePanelText(position({ requested: 'three-run-days', reason }))
      return [
        text.name,
        text.help,
        `${text.lead?.choice ?? ''}${text.lead?.rest ?? ''}`,
        text.grade,
      ]
    }),
  ]
}

describe('the plan shape copy', () => {
  it('registers every template, so the shared lint test renders them', () => {
    for (const id of Object.keys(METHOD_TEMPLATES)) {
      expect(id.startsWith('method.'), id).toBe(true)
      expect(id in TEMPLATES, id).toBe(true)
    }
  })

  it("offers the plan's own shape, three run days and a longer base, and never P3", () => {
    expect([...PLAN_SHAPES]).toEqual(['default', 'three-run-days', 'longer-base'])
    expect(PLAN_SHAPES.map(planShapeLabel)).toEqual([
      "The plan's own shape",
      'Three run days a week',
      'A longer base',
    ])
    expect(PLAN_SHAPES.map(presetRule)).toEqual(['P1', 'P2', 'P4'])
    expect(PLAN_SHAPES.map(planShapeLabel).join(' ')).not.toMatch(/shorter long run/i)
  })

  it('reads the run days and the weeks of base from the Params, in words', () => {
    expect(effective('three-run-days', 'f5.mastersMaxRunDays')).toBe(P.p2.runDays.value)
    expect(P.p2.runDays.value).toBe(3)
    expect(planShapeLabel('three-run-days')).toBe('Three run days a week')
    expect(planShapeHelp('three-run-days')).toBe(
      "At most three run days a week. The long run and the quality runs stay, and no week plans more minutes than the plan's own shape.",
    )
    // the default build is 6 weeks and the preset's is 4: the base takes the 2 between
    expect(P.macroDesign.buildWeeks.value - P.p4.buildWeeks.value).toBe(2)
    expect(planShapeHelp('longer-base')).toBe(
      "Strides only in the base, for up to two more weeks, then hills and threshold runs. No week plans more minutes than the plan's own shape.",
    )
    expect(planShapeHelp('default')).toBe(
      'Run days follow your weekly minutes and the days you have free, and the base comes first.',
    )
  })

  it('gives every shape the grade of its weakest part, D, and says it is a choice', () => {
    expect(planShapeGradeLine()).toBe('A choice, not a better plan (grade D).')
    for (const shape of PLAN_SHAPES) expect(presetGrade(shape), shape).toBe('D')
    expect(presetGrade('three-run-days')).toBe(P.p2.runDays.grade)
    expect(presetGrade('longer-base')).toBe(P.p4.buildWeeks.grade)
    expect(overrideGrade('three-run-days', 'f5.mastersMaxRunDays')).toBe(P.p2.runDays.grade)
    expect(overrideGrade('longer-base', 'macroDesign.buildWeeks')).toBe(P.p4.buildWeeks.grade)
    // a value the shape does not override reads D, the lowest grade
    expect(overrideGrade('default', 'macroDesign.buildWeeks')).toBe('D')
  })

  it("reads the grade of each value the plan's own shape holds from the registry", () => {
    const ids = [
      'f5.mastersMaxRunDays',
      'macroDesign.buildWeeks',
      'macroDesign.longRunShareOfWeek',
    ] as const
    const registry = new Map(allParams().map((param) => [param.id, param.grade]))
    for (const id of ids) {
      expect(registry.has(id), id).toBe(true)
      expect(defaultGrade(id), id).toBe(registry.get(id))
    }
    expect(longRunShare()).toBe(P.macroDesign.longRunShareOfWeek.value)
  })

  it('uses words that claim nothing better, faster or safer for any shape', () => {
    const text = allSentences().join(' ')
    expect(lintText(text)).toEqual([])
    // "better" appears only in "A choice, not a better plan"
    expect(text.replaceAll('A choice, not a better plan', '')).not.toMatch(
      /\b(better|best|optimal|optimum|faster|safer|safe|improve[sd]?|boost|maximi[sz]e)\b/i,
    )
    for (const sentence of allSentences()) expect(sentence, sentence).not.toBe('')
  })
})

describe('the choice on the Generate form', () => {
  it('lists the three shapes, each with its help and no note for a half marathon', () => {
    const rows = planShapeRows('half', null)
    expect(rows.map((row) => row.value)).toEqual(['default', 'three-run-days', 'longer-base'])
    expect(rows.every((row) => !row.disabled && row.notes.length === 0)).toBe(true)
    expect(rows.map((row) => row.help)).toEqual(PLAN_SHAPES.map(planShapeHelp))
  })

  it.each(['marathon', 'ultra50', 'ultra100k', 'ultra100mi', 'beyond'] as const)(
    'shows three run days disabled for a %s goal, with the reason, and leaves the others on',
    (distanceClass) => {
      const rows = planShapeRows(distanceClass, availability(5))
      const three = rows.find((row) => row.value === 'three-run-days')!
      expect(three.disabled).toBe(true)
      expect(three.notes).toEqual(['Not for a marathon or longer'])
      expect(rows.filter((row) => row.disabled).map((row) => row.value)).toEqual(['three-run-days'])
    },
  )

  it.each(['5k', '10k', 'half'] as const)(
    'offers three run days for a %s goal',
    (distanceClass) => {
      expect(planShapeOffered('three-run-days', distanceClass)).toBe(true)
      expect(planShapeOffered('longer-base', distanceClass)).toBe(true)
    },
  )

  it('offers every shape while the goal has no distance', () => {
    expect(planShapeRows(null, null).some((row) => row.disabled)).toBe(false)
  })

  it('counts the days the runner marked available', () => {
    expect(openDaysOf(availability(0))).toBe(0)
    expect(openDaysOf(availability(5))).toBe(5)
    expect(openDaysOf(availability(7))).toBe(7)
  })

  it('states what the days open say about three run days, as a fact and never a score', () => {
    expect(planShapeFitNote('three-run-days', 5)).toBe(
      'You have 5 days open; three run days leave two free.',
    )
    expect(planShapeFitNote('three-run-days', 7)).toBe(
      'You have 7 days open; three run days leave four free.',
    )
    expect(planShapeFitNote('three-run-days', 4)).toBe(
      'You have 4 days open; three run days leave one free.',
    )
    expect(planShapeFitNote('three-run-days', 3)).toBe(
      'You have 3 days open; three run days use all of them.',
    )
    expect(planShapeFitNote('three-run-days', 2)).toBe(
      'You have 2 days open, fewer than three run days.',
    )
    expect(planShapeFitNote('three-run-days', 1)).toBe(
      'You have 1 day open, fewer than three run days.',
    )
    // a shape that does not cap the run days has no such note
    expect(planShapeFitNote('longer-base', 5)).toBeNull()
    expect(planShapeFitNote('default', 5)).toBeNull()
  })

  it('puts the fit note on three run days when the profile is known, and only when it is offered', () => {
    const known = planShapeRows('10k', availability(5))
    expect(known.find((row) => row.value === 'three-run-days')!.notes).toEqual([
      'You have 5 days open; three run days leave two free.',
    ])
    expect(known.find((row) => row.value === 'longer-base')!.notes).toEqual([])
    const unknown = planShapeRows('10k', null)
    expect(unknown.find((row) => row.value === 'three-run-days')!.notes).toEqual([])
    const marathon = planShapeRows('marathon', availability(5))
    expect(marathon.find((row) => row.value === 'three-run-days')!.notes).toEqual([
      'Not for a marathon or longer',
    ])
  })

  it("words a persistent hold from the load setting's reasons", () => {
    expect(planShapeHeldLine('recent-injury')).toBe(
      "Held at the plan's own shape while a recent injury is on file.",
    )
    expect(planShapeHeldLine('bone-pain')).toBe(
      "Held at the plan's own shape while focal bone pain holds progression.",
    )
    expect(planShapeHeldLine('bsi-factors')).toMatch(
      /^Held at the plan's own shape while at least two risk factors for bone stress injury apply\.$/,
    )
  })

  it("reads the hold the server reports: the shape's reason first, then a persistent load hold", () => {
    expect(planShapeHold(null, null)).toBeNull()
    expect(planShapeHold(position(), null)).toBeNull()
    for (const hold of HOLDS) {
      expect(
        planShapeHold(position({ requested: 'longer-base', reason: `held:${hold}` }), null),
        hold,
      ).toBe(hold)
      expect(
        planShapeHold(position(), {
          requested: 'standard',
          position: 'steady',
          held: hold,
          ageCapped: false,
        }),
        hold,
      ).toBe(hold)
    }
    // the transient holds of the load setting do not hold a shape
    for (const held of ['rest-window', 'post-race'] as const) {
      expect(
        planShapeHold(position(), {
          requested: 'standard',
          position: 'steady',
          held,
          ageCapped: false,
        }),
      ).toBeNull()
    }
    // a reason that is not a hold names none
    expect(
      planShapeHold(position({ requested: 'three-run-days', reason: 'not-applicable' }), null),
    ).toBeNull()
  })
})

describe('the Plan page panel', () => {
  it("words each reason a shape reads as the plan's own", () => {
    expect(methodReasonText('not-applicable')).toBe('not for this goal')
    expect(methodReasonText('novice')).toBe('the start weeks keep their novice days')
    expect(methodReasonText('no-base')).toBe('there is no base to lengthen')
    expect(methodReasonText('held:recent-injury')).toBe('held while a recent injury is on file')
    for (const hold of HOLDS) {
      expect(methodReasonText(`held:${hold}`), hold).toMatch(/^held while .+/)
    }
  })

  it('names the shape in effect with its help and the grade line, and no lead when it applies', () => {
    const text = planShapePanelText(
      position({ requested: 'longer-base', effective: 'longer-base' }),
    )
    expect(text).toEqual({
      name: 'A longer base',
      help: planShapeHelp('longer-base'),
      lead: null,
      grade: 'A choice, not a better plan (grade D).',
    })
    expect(planShapePanelText(position()).name).toBe("The plan's own shape")
    expect(planShapePanelText(position()).lead).toBeNull()
  })

  it("leads with the choice and the reason when the shape chosen reads as the plan's own", () => {
    const text = planShapePanelText(
      position({ requested: 'three-run-days', reason: 'not-applicable' }),
    )
    expect(text.name).toBe("The plan's own shape")
    expect(text.lead).toEqual({
      choice: 'Three run days a week',
      rest: ", read as the plan's own shape: not for this goal.",
    })
    expect(
      planShapePanelText(position({ requested: 'longer-base', reason: 'held:bone-stress' })).lead,
    ).toEqual({
      choice: 'A longer base',
      rest: ", read as the plan's own shape: held while an earlier bone stress injury is on file.",
    })
  })

  it('opens the Why drawer on the rules of the shape, and on P1 for the reason', () => {
    expect(planShapeWhyRules(position())).toEqual(['P1'])
    expect(
      planShapeWhyRules(position({ requested: 'three-run-days', effective: 'three-run-days' })),
    ).toEqual(['P2', 'F5'])
    expect(
      planShapeWhyRules(position({ requested: 'longer-base', effective: 'longer-base' })),
    ).toEqual(['P4', 'E2'])
    expect(planShapeWhyRules(position({ requested: 'longer-base', reason: 'no-base' }))).toEqual([
      'P1',
      'P4',
    ])
  })
})

describe('what the drawer states about a shape', () => {
  it('words the quality kinds as the table of the preset holds them', () => {
    // the sentence restates `QUALITY_BY_PRESET['longer-base']` (micro.ts); a change of the table
    // fails here until the sentence follows it
    expect(QUALITY_BY_PRESET['longer-base'].base).toEqual(['strides'])
    expect(QUALITY_BY_PRESET['longer-base'].build).toEqual(['hills', 'threshold'])
    expect(METHOD_TEMPLATES['method.fact.kinds'].text).toBe(
      'Quality runs: strides only in the base, then hills and threshold runs in the build (grade {grade}).',
    )
    expect(PRESET_OVERRIDES['longer-base'].qualityByPhase).toBe(true)
  })

  it('credits a book only through a record that passes R1', () => {
    // The records the two Params of section (p) cite: a `book-or-guideline` record among them must
    // carry vetting with R1 `pass` (README R1; `research:check` holds the same gate for the corpus).
    const cited = [P.p2.runDays, P.p4.buildWeeks].flatMap((param) => param.evidence)
    expect(cited.length).toBeGreaterThan(0)
    const books = cited
      .map((id) => ({
        id,
        record: JSON.parse(
          readFileSync(join(process.cwd(), 'research', 'papers', `${id}.json`), 'utf8'),
        ) as { design: string; vetting?: { r1: { result: string } } },
      }))
      .filter(({ record }) => record.design === 'book-or-guideline')
    expect(books.length).toBeGreaterThan(0)
    for (const { id, record } of books) expect(record.vetting?.r1.result, id).toBe('pass')
  })
})
