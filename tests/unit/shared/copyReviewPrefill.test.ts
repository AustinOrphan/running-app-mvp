import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { PLAN_STRIP_TEMPLATES, planStripSentence } from '../../../shared/copy/planStrip.ts'
import { prefillLines, REVIEW_PREFILL_TEMPLATES } from '../../../shared/copy/reviewPrefill.ts'
import { render, sampleSlots, type Template } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { prefillFromCheckins, type CheckinDay } from '../../../shared/domain/review.ts'

const all = { ...REVIEW_PREFILL_TEMPLATES, ...PLAN_STRIP_TEMPLATES }

describe('the review prefill and plan strip templates', () => {
  it.each(Object.keys(all))('%s is registered and renders clean', (id) => {
    const template: Template = all[id as keyof typeof all]
    expect(TEMPLATES[id as keyof typeof TEMPLATES]).toBe(template)
    for (const text of [render(template, sampleSlots(template), 'km'), template.fallback]) {
      expect(lintText(text), text).toEqual([])
      if (template.shape === 'sentence') expect(text, id).toMatch(/\.$/)
    }
  })

  it('words each basis of the symptoms line without "(s)"', () => {
    const week = '2026-03-02'
    const day = (n: number, over: Partial<CheckinDay> = {}): CheckinDay => ({
      date: `2026-03-0${String(n + 2)}`,
      fatigue: 3,
      ...over,
    })
    const cases: Array<[CheckinDay[], RegExp]> = [
      [[day(0), day(1)], /^Symptoms: none\./],
      [[day(0), day(1, { soreness: 4 })], /^Symptoms: mild\. Soreness of 4 or more/],
      [[day(0), day(1, { painScore: 2 })], /^Symptoms: mild\. A pain score/],
      [[day(0), day(1, { illness: true })], /^Symptoms: mild\. Illness/],
      [
        [0, 1, 2].map((n) => day(n, { painScore: 5 })),
        /persistent\. A pain score of 4 or more on three/,
      ],
      [[day(0), day(1, { painFocalBone: true })], /persistent\. Bone tenderness/],
    ]
    for (const [days, pattern] of cases) {
      const lines = prefillLines(prefillFromCheckins(week, days)!)
      expect(lines.symptoms).toMatch(pattern)
      expect(lintText(lines.symptoms)).toEqual([])
    }
    const one = prefillLines(prefillFromCheckins(week, [day(0)])!)
    expect(one.basis).toBe('Taken from 1 day of check-ins. Confirm each answer or change it below.')
    expect(one.fatigue).toMatch(/too few answers/)
    expect(one.symptoms).toMatch(/too few check-in days/)
  })

  it('words the fatigue line with the number and its basis', () => {
    const lines = prefillLines(
      prefillFromCheckins('2026-03-02', [
        { date: '2026-03-02', fatigue: 4 },
        { date: '2026-03-03', fatigue: 5 },
      ])!,
    )
    expect(lines.fatigue).toBe('Fatigue 8 of 10, from an average of 4.5 of 5 over 2 days.')
  })

  it('words the plan strip by the number of sessions', () => {
    expect(planStripSentence('Monday', 0, 'mi')).toBe(
      'Updated Monday: the running time of the weeks ahead changed.',
    )
    expect(planStripSentence('Monday', 1, 'mi')).toBe('Updated Monday: one session changed.')
    expect(planStripSentence('Monday', 2, 'km')).toBe('Updated Monday: 2 sessions changed.')
  })
})
