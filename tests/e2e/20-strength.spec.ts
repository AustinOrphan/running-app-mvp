import { expect, test, type Locator, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { Activity, PlanWithSessions, StrengthLog, StrengthView } from '../../shared/types.ts'
import { lb } from '../web/strength-fixtures.ts'
import {
  apiFor,
  barbellAndDumbbells,
  nextStrengthWorkout,
  planWithRunToday,
  relativeDates,
  saveStartingPoints,
  saveStrengthSetup,
  seedUnloggedStrengthWeeks,
  signedInApi,
  strengthOnlyToday,
  toast,
  withoutRecoveryWeeks,
} from './helpers.ts'

// Strength programming as the runner uses it (strength design 13, ADR 0014). Each test starts over
// from an empty log (`resetData` inside `strengthOnlyToday`) with a plan whose first strength
// session is today, and stands on its own.
//
// Covered elsewhere: the hero's rows, "Log sets" in place of Done, the first screen at 390 x 844 and
// 360 x 740, the refused-log notice and the hit area of the "Also today" item are E14-8's cases in
// `12-today.spec.ts` (its "logging as suggested is three interactions" case does the three steps and
// does not count them; the count is here). The 360 px layout of the Strength page and of its two
// sheets is in `06-narrow-viewport.spec.ts`, and a strength log saved with no connection is in
// `17-offline.spec.ts`, the only spec that allows service workers.

/**
 * An empty log, a plan with a strength session today and the page signed in, in pounds. The account
 * outlives `resetData`, and with it the weight unit a test before this one chose.
 */
async function startDay(page: Page, baseURL: string | undefined, withRun = false) {
  const origin = baseURL ?? ''
  const session = await strengthOnlyToday(page, origin, withRun)
  const api = apiFor(page, origin)
  await api.put('/settings', { weightUnit: 'lb' })
  return { session, origin, api }
}

/** The logging sheet, however it was opened: its title names the session ("Strength, ramp-in A"). */
function loggingSheet(page: Page): Locator {
  return page.getByRole('dialog', { name: /^Strength, / })
}

/** One exercise of the logging sheet: a section named by the exercise. */
function liftIn(sheet: Locator, exercise: string): Locator {
  return sheet.getByRole('region', { name: exercise, exact: true })
}

/** The names of the exercises of a sheet in order: the lifts first, then the jumps and the trunk work. */
function exercisesIn(sheet: Locator): Promise<string[]> {
  return sheet.getByRole('heading', { level: 3 }).allInnerTexts()
}

/** The row of the Next session card for an exercise. */
function rowOf(card: Locator, exercise: string): Locator {
  return card.getByRole('listitem').filter({ hasText: exercise })
}

/**
 * Starts counting what the runner does on the page: every click and key press the browser itself
 * made (a trusted event; a script's `dispatchEvent` does not count), by the name of the control it
 * landed on. A typed value counts as a press for each key, so the counted flows below use the
 * steppers and the scales only. Counting restarts at every call.
 */
async function countInteractions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as { __interactions?: string[] }
    if (holder.__interactions !== undefined) {
      holder.__interactions.length = 0
      return
    }
    const seen: string[] = []
    holder.__interactions = seen
    const record = (event: Event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return
      const named =
        event.target.closest('button, a, input, textarea, select, label') ?? event.target
      seen.push(`${event.type}: ${named.getAttribute('aria-label') ?? named.textContent.trim()}`)
    }
    document.addEventListener('click', record, true)
    document.addEventListener('keydown', record, true)
  })
}

/** What `countInteractions` has seen since it was last called. */
function interactions(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...((window as unknown as { __interactions?: string[] }).__interactions ?? []),
  ])
}

// ---- The setup ---------------------------------------------------------------------------------

test('the setup is saved with a barbell and dumbbells from the Set up strength card, and the workout follows', async ({
  page,
  baseURL,
}) => {
  const { api } = await startDay(page, baseURL)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/strength')

  // until the setup is saved the workout is bodyweight only, and the page offers the setup
  const offer = page.getByRole('region', { name: 'Set up strength' })
  const next = page.getByRole('region', { name: 'Next session' })
  await expect(offer).toBeVisible()
  await expect(
    next.getByText(
      'This workout is bodyweight only. Set up strength and the lifts use the saved equipment.',
    ),
  ).toBeVisible()
  await expect(rowOf(next, 'Tempo squat')).toBeVisible()
  await expect(offer.getByRole('button')).toHaveText([
    'Weight unit',
    'Equipment',
    'Lifting history',
    'Exercises',
    'Starting points',
  ])

  await offer.getByRole('button', { name: 'Equipment', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Equipment' })
  await sheet.getByRole('checkbox', { name: 'Barbell, plates and a rack' }).check()
  await sheet.getByRole('textbox', { name: 'Bar weight in pounds' }).fill('45')
  await sheet.getByRole('textbox', { name: 'Smallest pair of plates in pounds' }).fill('5')
  await sheet.getByRole('checkbox', { name: 'Dumbbells' }).check()
  await sheet.getByRole('textbox', { name: 'Lightest weight in pounds' }).fill('10')
  await sheet.getByRole('textbox', { name: 'Heaviest weight in pounds' }).fill('50')
  await sheet.getByRole('textbox', { name: 'Step in pounds' }).fill('5')
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, 'Strength setup saved')).toBeVisible()
  await expect(sheet).toBeHidden()

  // the first save ends the offer, and the next workout is for the equipment now saved
  await expect(offer).toBeHidden()
  await expect(
    next.getByText(
      'This workout is bodyweight only. Set up strength and the lifts use the saved equipment.',
    ),
  ).toBeHidden()
  await expect(rowOf(next, 'Goblet squat')).toContainText(
    'Suggested 10 lb, two sets of 6 to 8 reps',
  )
  await expect(rowOf(next, 'Tempo squat')).toBeHidden()
  const units = page.getByRole('region', { name: 'Equipment and units' })
  await expect(units.getByText('Barbell, plates and a rack, Dumbbells')).toBeVisible()

  const view = (await api.get('/strength')) as StrengthView
  expect(view.setupSaved).toBe(true)
  expect(view.settings.equipment).toEqual(barbellAndDumbbells())
})

test('Today offers Set up strength while a strength session is within a week and the setup is not saved', async ({
  page,
  baseURL,
}) => {
  const { session, origin, api } = await startDay(page, baseURL)
  await page.goto('/')
  await expect(page.getByRole('article', { name: session.title })).toBeVisible()
  const offer = page.getByRole('region', { name: 'Set up strength' })
  await expect(
    offer.getByText(
      'A strength session is coming up, and its workout is for bodyweight only until the setup is saved.',
    ),
  ).toBeVisible()
  await offer.getByRole('link', { name: 'Open Strength' }).click()
  await expect(page).toHaveURL(/\/strength$/)
  await expect(page.getByRole('heading', { name: 'Strength', level: 1 })).toBeVisible()

  // saved: the card is gone from Today
  await saveStrengthSetup(api)
  await page.goto('/')
  await expect(page.getByRole('article', { name: session.title })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Set up strength' })).toBeHidden()

  // a plan with no strength session has nothing to ask the setup for
  await signedInApi(page, origin)
  await planWithRunToday(api, page, origin, 'Run only marathon')
  await page.goto('/')
  await expect(page.getByRole('article').first()).toBeVisible()
  await expect(page.getByRole('region', { name: 'Set up strength' })).toBeHidden()
})

// ---- A change of equipment and of the weight unit ------------------------------------------------

test('a change of equipment and of the weight unit is followed by the next workout and the sheet', async ({
  page,
  baseURL,
}) => {
  const { session, api } = await startDay(page, baseURL)
  await saveStrengthSetup(api)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/strength')
  const next = page.getByRole('region', { name: 'Next session' })
  await expect(rowOf(next, 'Goblet squat')).toContainText('Suggested 10 lb')

  // the lightest dumbbell is now 20 lb: the lifts start there
  await page.getByRole('button', { name: 'Edit equipment' }).click()
  const sheet = page.getByRole('dialog', { name: 'Equipment' })
  await sheet.getByRole('textbox', { name: 'Lightest weight in pounds' }).fill('20')
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, 'Strength setup saved')).toBeVisible()
  await expect(rowOf(next, 'Goblet squat')).toContainText('Suggested 20 lb')

  // pounds to kilograms: every load follows, here and on Today and in the logging sheet
  await page.getByRole('radio', { name: 'Kilograms' }).click()
  await expect(toast(page, 'Weight unit saved')).toBeVisible()
  await expect(rowOf(next, 'Goblet squat')).toContainText('Suggested 9 kg')
  await next.getByRole('button', { name: 'Log sets' }).click()
  const logging = loggingSheet(page)
  await expect(logging.getByText(/Loads are in kilograms\.$/)).toBeVisible()
  await expect(
    liftIn(logging, 'Goblet squat').getByRole('group', { name: 'Goblet squat, set 1, load' }),
  ).toContainText('kg')
  await logging.getByRole('button', { name: 'Close' }).click()
  await expect(logging).toBeHidden()
  await page.goto('/')
  await expect(
    page.getByRole('article', { name: session.title }).getByRole('listitem').first(),
  ).toContainText(/9 kg/)

  // the dumbbells go back to the shelf: the same session is built from what is left
  await page.goto('/strength')
  await page.getByRole('button', { name: 'Edit equipment' }).click()
  await sheet.getByRole('checkbox', { name: 'Dumbbells' }).uncheck()
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, 'Strength setup saved')).toBeVisible()
  await expect(rowOf(next, 'Goblet squat')).toBeHidden()
  await expect(rowOf(next, 'Tempo squat')).toBeVisible()
})

// ---- Logging ---------------------------------------------------------------------------------------

test('a session is logged as suggested in three interactions from the Strength page', async ({
  page,
  baseURL,
}) => {
  const { api } = await startDay(page, baseURL)
  await saveStrengthSetup(api)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/strength')
  const next = page.getByRole('region', { name: 'Next session' })
  await expect(rowOf(next, 'Goblet squat')).toBeVisible()

  // the bar of design 1.4: open the sheet, "As suggested", Save. The page counts what the browser
  // does, so a fourth step (a confirmation, a second tap on a field) would show here.
  await countInteractions(page)
  await next.getByRole('button', { name: 'Log sets' }).click()
  const sheet = loggingSheet(page)
  await sheet.getByRole('button', { name: 'As suggested' }).click()
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, /^Strength log saved/)).toBeVisible()
  await expect(sheet).toBeHidden()

  const steps = await interactions(page)
  expect(steps).toEqual(['click: Log sets', 'click: As suggested', 'click: Save'])
  expect(steps.length).toBeLessThanOrEqual(3)
  test
    .info()
    .annotations.push({ type: 'interactions', description: `${steps.length} as suggested` })

  // the log is the suggestion
  const view = (await api.get('/strength')) as StrengthView
  expect(view.recent).toHaveLength(1)
  const sets = view.recent[0]?.sets ?? []
  expect(sets.filter((set) => set.exerciseId === 'goblet-squat')).toHaveLength(2)
  expect(sets.find((set) => set.exerciseId === 'goblet-squat')).toMatchObject({
    loadG: lb(10),
    count: 6,
    rir: 3,
  })
})

test('two changed sets and one reps-left value for each lift are logged in at most twelve interactions', async ({
  page,
  baseURL,
}) => {
  const { api } = await startDay(page, baseURL)
  await saveStrengthSetup(api)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/strength')
  const next = page.getByRole('region', { name: 'Next session' })
  await expect(rowOf(next, 'Goblet squat')).toBeVisible()
  const workout = await nextStrengthWorkout(api)
  expect(workout.lifts).toHaveLength(3)

  // open (1), "As suggested" (1), then for each of the three lifts one press on the load of each of
  // two sets and one value for all its sets (3 each, 9), and Save (1): the twelve of design 9.1
  await countInteractions(page)
  await next.getByRole('button', { name: 'Log sets' }).click()
  const sheet = loggingSheet(page)
  await sheet.getByRole('button', { name: 'As suggested' }).click()
  const names = (await exercisesIn(sheet)).slice(0, workout.lifts.length)
  for (const name of names) {
    const section = liftIn(sheet, name)
    for (const set of [1, 2]) {
      await section
        .getByRole('group', { name: `${name}, set ${String(set)}, load` })
        .getByRole('button', { name: 'Raise the load by one step' })
        .click()
    }
    await section.getByRole('button', { name: `All sets, ${name}, reps left 2` }).click()
  }
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, /^Strength log saved/)).toBeVisible()
  await expect(sheet).toBeHidden()

  const steps = await interactions(page)
  expect(steps).toHaveLength(12)
  expect(steps[0]).toBe('click: Log sets')
  expect(steps[1]).toBe('click: As suggested')
  expect(steps.at(-1)).toBe('click: Save')
  expect(steps.length).toBeLessThanOrEqual(12)
  test
    .info()
    .annotations.push({ type: 'interactions', description: `${steps.length} with changes` })

  // what was entered is what was saved: a step up on both sets, and the reps left the lift got
  const view = (await api.get('/strength')) as StrengthView
  const sets = view.recent[0]?.sets ?? []
  for (const lift of workout.lifts) {
    const ofLift = sets.filter((set) => set.exerciseId === lift.exerciseId)
    expect(ofLift).toHaveLength(2)
    for (const set of ofLift) {
      expect(set.loadG).toBe((lift.loadG ?? 0) + lb(5))
      expect(set.rir).toBe(2)
    }
  }
})

// ---- The next load -----------------------------------------------------------------------------------

test('the next load rises one step after a session at the top of the range with reps left', async ({
  page,
  baseURL,
}) => {
  const { api } = await startDay(page, baseURL)
  await saveStrengthSetup(api)
  // a first load of 40 lb (70% of a known 60 lb), where one 5 lb step is within the 90% ceiling
  await saveStartingPoints(api, ['goblet-squat', 'dumbbell-rdl', 'standing-calf-raise'], 60)
  await withoutRecoveryWeeks()
  const first = await nextStrengthWorkout(api)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/strength')
  const next = page.getByRole('region', { name: 'Next session' })
  await next.getByRole('button', { name: 'Log sets' }).click()
  const sheet = loggingSheet(page)
  await sheet.getByRole('button', { name: 'As suggested' }).click()

  // every set at the top of the range, two reps left
  const names = (await exercisesIn(sheet)).slice(0, first.lifts.length)
  for (const [index, name] of names.entries()) {
    const section = liftIn(sheet, name)
    const top = String(first.lifts[index]?.range.max)
    for (const set of [1, 2]) {
      await section.getByRole('textbox', { name: `${name}, set ${String(set)}, reps` }).fill(top)
    }
    await section.getByRole('button', { name: `All sets, ${name}, reps left 2` }).click()
  }
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()

  // the save says what is asked next time, and the next session is one step up. The two lifts that
  // both variants of the session hold are read; the calf raise is not the same exercise in each.
  const progressing = ['Goblet squat', 'Dumbbell Romanian deadlift']
  const saved = toast(page, /^Strength log saved\. Next time: /)
  await expect(saved).toBeVisible()
  for (const name of progressing) await expect(saved).toContainText(`${name} up to 45 lb`)
  await expect(sheet).toBeHidden()
  for (const name of progressing) {
    await expect(rowOf(next, name)).toContainText('Suggested 45 lb')
    await expect(rowOf(next, name)).toContainText('Up one step')
  }
  const after = await nextStrengthWorkout(api)
  expect(after.sessionId).not.toBe(first.sessionId)
  for (const id of ['goblet-squat', 'dumbbell-rdl']) {
    expect(after.lifts.find((candidate) => candidate.exerciseId === id)).toMatchObject({
      loadG: lb(45),
      change: 'increase',
    })
  }

  // the lift's history is a table by date, with the estimated maximum worked out from the sets
  const lifts = page.getByRole('region', { name: 'Lifts' })
  await expect(lifts.getByText(/^about \d+(\.\d)? lb$/).first()).toBeVisible()
  await lifts.getByRole('button', { name: 'History of Goblet squat' }).click()
  const history = page.getByRole('region', { name: 'History of Goblet squat' })
  await expect(history.getByRole('row')).toHaveCount(2)
  await expect(history.getByRole('row').nth(1)).toContainText('40 lb x 8, 2 left')
  await expect(
    page.getByText(
      'The estimated maximum is worked out from sets, not tested. It is a rough guide.',
    ),
  ).toBeVisible()
})

test('a set short of the range gives a lighter next load, with its reason in the Why drawer', async ({
  page,
  baseURL,
}) => {
  const { api } = await startDay(page, baseURL)
  await saveStrengthSetup(api)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/strength')
  const next = page.getByRole('region', { name: 'Next session' })
  await next.getByRole('button', { name: 'Log sets' }).click()
  const sheet = loggingSheet(page)
  await sheet.getByRole('button', { name: 'As suggested' }).click()

  // Goblet squat at 20 lb, the second set of it three reps (the range is 6 to 8)
  const squat = liftIn(sheet, 'Goblet squat')
  for (const set of [1, 2]) {
    const raise = squat
      .getByRole('group', { name: `Goblet squat, set ${String(set)}, load` })
      .getByRole('button', { name: 'Raise the load by one step' })
    await raise.click()
    await raise.click()
  }
  await squat.getByRole('textbox', { name: 'Goblet squat, set 2, reps' }).fill('3')
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  const saved = toast(page, /^Strength log saved\. Next time: /)
  await expect(saved).toBeVisible()
  await expect(saved).toContainText('Goblet squat comes down to 15 lb')
  await expect(sheet).toBeHidden()

  await expect(rowOf(next, 'Goblet squat')).toContainText('Suggested 15 lb')
  const after = await nextStrengthWorkout(api)
  expect(after.lifts.find((candidate) => candidate.exerciseId === 'goblet-squat')).toMatchObject({
    loadG: lb(15),
    change: 'reduce',
  })

  // the next session's sheet gives the reason for the lighter load, and the drawer the facts
  await next.getByRole('button', { name: 'Log sets' }).click()
  const logging = loggingSheet(page)
  const reason =
    'Set 2 of Goblet squat ended at 3 reps, below the 6 to 8 range, so the load comes down one step.'
  await expect(liftIn(logging, 'Goblet squat').getByText(reason)).toBeVisible()
  await liftIn(logging, 'Goblet squat').getByRole('button', { name: 'Why: Goblet squat' }).click()
  const drawer = page.getByRole('dialog', { name: 'Why this?' })
  await expect(drawer.getByText(reason)).toBeVisible()
  // the rule is named with its grade: a default that no study in runners has tested
  await expect(drawer.getByText('Strength load progression').first()).toBeVisible()
  await expect(
    drawer.getByText(/No study in runners compares ways of choosing the next load\./),
  ).toBeVisible()
})

// ---- The bodyweight path -------------------------------------------------------------------------------

test('a runner with no equipment logs bodyweight lifts with no load field, then saves the setup with none', async ({
  page,
  baseURL,
}) => {
  const { session, api } = await startDay(page, baseURL)
  await page.setViewportSize({ width: 390, height: 844 })

  // never set up: Today lists the lifts with no load, and the sheet says why
  await page.goto('/')
  const card = page.getByRole('article', { name: session.title })
  const rows = card.getByRole('list', { name: /^Strength, / }).getByRole('listitem')
  await expect(rows.first()).toContainText('Tempo squat')
  await expect(rows.first()).not.toContainText(/\d+ (lb|kg)/)
  await card.getByRole('button', { name: 'Log sets' }).click()
  const sheet = loggingSheet(page)
  await expect(
    sheet.getByText('The workout is for bodyweight only until the setup is saved.'),
  ).toBeVisible()
  await expect(sheet.getByRole('link', { name: 'Set up strength' })).toBeVisible()
  await expect(
    liftIn(sheet, 'Tempo squat').getByRole('group', {
      name: 'Tempo squat, set 1, reps',
      exact: true,
    }),
  ).toBeVisible()
  await expect(sheet.getByRole('group', { name: /, load$/ })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'As suggested' }).click()
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, /^Strength log saved/)).toBeVisible()
  await expect(card.getByText('Completed')).toBeVisible()

  // every set is saved with no load, and the page lists the lifts as having none
  const view = (await api.get('/strength')) as StrengthView
  expect(view.recent[0]?.sets.length).toBeGreaterThan(0)
  for (const set of view.recent[0]?.sets ?? []) expect(set.loadG).toBeNull()
  await page.goto('/strength')
  const lifts = page.getByRole('region', { name: 'Lifts' })
  const tempo = lifts.getByRole('listitem').filter({ hasText: 'Tempo squat' })
  await expect(tempo.getByText('No added load', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Set up strength' })).toBeVisible()

  // a setup saved with no equipment ends the offer and keeps the workout bodyweight
  await page.getByRole('button', { name: 'Edit lifting history' }).click()
  const history = page.getByRole('dialog', { name: 'Lifting history' })
  await history.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, 'Strength setup saved')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Set up strength' })).toBeHidden()
  const units = page.getByRole('region', { name: 'Equipment and units' })
  await expect(units.getByText('None saved, so workouts are bodyweight only.')).toBeVisible()
  const saved = (await api.get('/strength')) as StrengthView
  expect(saved.setupSaved).toBe(true)
  expect(saved.settings.equipment).toEqual([])
  expect(saved.next[0]?.lifts.every((lift) => lift.loadG === null)).toBe(true)
})

// ---- A day with no planned session ---------------------------------------------------------------------

test('with no strength session planned, Log a session and Add a past session start from the week of the day', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL ?? ''
  const api = await signedInApi(page, origin)
  await planWithRunToday(api, page, origin, 'No strength marathon')
  await api.put('/settings', { weightUnit: 'lb' })
  await saveStrengthSetup(api)
  const { today } = relativeDates()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/strength')
  const next = page.getByRole('region', { name: 'Next session' })
  await expect(
    next.getByText('No strength session is planned. Choose how many a week on the Profile.'),
  ).toBeVisible()
  await expect(next.getByRole('link', { name: 'Open the Profile' })).toBeVisible()
  await expect(next.getByRole('button', { name: 'Log sets' })).toBeHidden()

  // "Log a session": the sheet reads the week's own session from the server
  await next.getByRole('button', { name: 'Log a session' }).click()
  const sheet = page.getByRole('dialog', { name: /^Strength/ })
  await expect(sheet.getByText(/^From this week's .+ session\.$/)).toBeVisible()
  await sheet.getByRole('button', { name: 'As suggested' }).click()
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, /^Strength log saved/)).toBeVisible()
  await expect(sheet).toBeHidden()
  const recent = page.getByRole('region', { name: 'Recent sessions' })
  await expect(recent.getByRole('listitem')).toHaveCount(1)

  // "Add a past session": a day within the last year, then the same sheet for that day
  const past = addDays(today, -9)
  await next.getByRole('button', { name: 'Add a past session' }).click()
  await next.getByLabel('Date of the session').fill(past)
  await next.getByRole('button', { name: 'Continue' }).click()
  await expect(sheet.getByText(/^From the .+ session of the week of .+\.$/)).toBeVisible()
  await sheet.getByRole('button', { name: 'As suggested' }).click()
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, /^Strength log saved/)).toBeVisible()
  await expect(recent.getByRole('listitem')).toHaveCount(2)

  // two sessions that stand for no planned session, each its own strength activity
  const view = (await api.get('/strength')) as StrengthView
  expect(view.recent.map((log) => log.date)).toEqual([today, past])
  const found = (await api.get(`/activities?from=${past}&to=${today}`)) as { items: Activity[] }
  expect(found.items.filter((item) => item.type === 'strength')).toHaveLength(2)
  const plan = (await api.get('/plan')) as { sessions: Array<{ activityId: string | null }> }
  expect(plan.sessions.filter((item) => item.activityId !== null)).toHaveLength(0)
})

// ---- Swap and Add a lift ------------------------------------------------------------------------------------

test('Swap and Add a lift read the lift from the server, and the saved log holds them', async ({
  page,
  baseURL,
}) => {
  const { api } = await startDay(page, baseURL)
  await saveStrengthSetup(api)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/strength')
  await page
    .getByRole('region', { name: 'Next session' })
    .getByRole('button', { name: 'Log sets' })
    .click()
  const sheet = loggingSheet(page)
  await expect(liftIn(sheet, 'Goblet squat')).toBeVisible()
  const before = await exercisesIn(sheet)

  // Swap: the choices are the exercises of the slot the equipment makes; the chosen one is worked out
  // by the server for this session, with the sets and the first load of an exercise never logged
  const readSwap = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === '/api/strength/workout' &&
      new URL(request.url()).searchParams.has('swap'),
  )
  await liftIn(sheet, 'Goblet squat').getByRole('button', { name: 'Swap: Goblet squat' }).click()
  const choices = liftIn(sheet, 'Goblet squat').getByRole('group', {
    name: 'Swap Goblet squat for',
  })
  const swapped = (await choices.getByRole('button').first().innerText()).trim()
  await choices.getByRole('button').first().click()
  await readSwap
  await expect(sheet.getByRole('heading', { name: swapped, level: 3, exact: true })).toBeVisible()
  await expect(
    sheet.getByRole('heading', { name: 'Goblet squat', level: 3, exact: true }),
  ).toBeHidden()
  await expect(
    liftIn(sheet, swapped).getByText(`${swapped} has no sets logged yet`, { exact: false }),
  ).toBeVisible()

  // Add a lift: after the last exercise, read the same way
  const readAdd = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === '/api/strength/workout' &&
      new URL(request.url()).searchParams.has('swap'),
  )
  await sheet.getByRole('button', { name: 'Add a lift' }).click()
  const addable = sheet.getByRole('group', { name: 'Lifts to add' })
  const added = (await addable.getByRole('button').first().innerText()).trim()
  await addable.getByRole('button').first().click()
  await readAdd
  await expect(sheet.getByRole('heading', { name: added, level: 3, exact: true })).toBeVisible()
  const after = await exercisesIn(sheet)
  expect(after).toContain(added)
  expect(after.length).toBe(before.length + 1)
  expect(after.indexOf(added)).toBe(after.length - 1)

  await sheet.getByRole('button', { name: 'As suggested' }).click()
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, /^Strength log saved/)).toBeVisible()
  await expect(sheet).toBeHidden()
  const sets = ((await api.get('/strength')) as StrengthView).recent[0]?.sets ?? []
  const ids = [...new Set(sets.map((set) => set.exerciseId))]
  expect(ids).not.toContain('goblet-squat')
  expect(ids.length).toBeGreaterThanOrEqual(before.length)
})

// ---- The activity page ---------------------------------------------------------------------------------------

test('an imported strength activity gets its sets from the activity page: Add the sets, then Edit sets', async ({
  page,
  baseURL,
}) => {
  const { api } = await startDay(page, baseURL)
  await saveStrengthSetup(api)
  const day = addDays(relativeDates().today, -3)
  const imported = (await api.post('/activities', {
    date: day,
    type: 'strength',
    durationSec: 40 * 60,
  })) as Activity
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/activities/${imported.id}`)
  const sets = page.getByRole('region', { name: 'Sets', exact: true })
  await expect(sets.getByText('No sets are logged for this session.')).toBeVisible()
  await expect(sets.getByRole('button', { name: 'Edit sets' })).toBeHidden()

  // the sets attach to the activity that is there: no second activity, no "Save without sets"
  await sets.getByRole('button', { name: 'Add the sets' }).click()
  const sheet = page.getByRole('dialog', { name: /^Strength, / })
  await expect(sheet.getByRole('button', { name: 'As suggested' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Save without sets' })).toBeHidden()
  await sheet.getByRole('button', { name: 'As suggested' }).click()
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, /^Strength log saved/)).toBeVisible()
  await expect(sheet).toBeHidden()
  const table = sets.getByRole('region', { name: 'Sets of this session' })
  const logged = (await api.get(`/strength/logs?activityId=${imported.id}`)) as StrengthLog[]
  expect(logged).toHaveLength(1)
  await expect(table.getByRole('row')).toHaveCount(1 + (logged[0]?.sets.length ?? 0))
  await expect(sets.getByRole('button', { name: 'Add the sets' })).toBeHidden()

  // Edit sets: the sheet opens on the saved log and saves over it
  await sets.getByRole('button', { name: 'Edit sets' }).click()
  await expect(sheet.getByRole('button', { name: 'Same as last time' })).toBeHidden()
  await expect(sheet.getByRole('button', { name: /^Swap/ })).toHaveCount(0)
  const squat = liftIn(sheet, 'Goblet squat')
  await squat.getByRole('textbox', { name: 'Goblet squat, set 1, reps' }).fill('7')
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, /^Strength log saved/)).toBeVisible()
  await expect(sheet).toBeHidden()
  await expect(table.getByRole('row').nth(1)).toContainText('7')
  const edited = (await api.get(`/strength/logs?activityId=${imported.id}`)) as StrengthLog[]
  expect(edited).toHaveLength(1)
  expect(edited[0]?.id).toBe(logged[0]?.id)
  expect(edited[0]?.sets.find((set) => set.exerciseId === 'goblet-squat')?.count).toBe(7)
  const found = (await api.get(`/activities?from=${day}&to=${day}`)) as { items: Activity[] }
  expect(found.items.filter((item) => item.type === 'strength')).toHaveLength(1)
})

// ---- The count prompt ---------------------------------------------------------------------------------------

/** The question of design 12.4, as one group named by its sentence. */
function countQuestion(page: Page): Locator {
  return page.getByRole('group', {
    name: 'Two a week is the plan; one fits a busy stretch too. Plan one a week?',
  })
}

test('"Not now" on the count prompt keeps it away for four weeks and changes nothing', async ({
  page,
  baseURL,
}) => {
  const { api } = await startDay(page, baseURL)
  await saveStrengthSetup(api)
  await seedUnloggedStrengthWeeks()
  const { today } = relativeDates()
  const view = (await api.get('/strength')) as StrengthView
  expect(view.lowCountWeeks).toBe(3)
  expect(view.countPrompt).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/strength')
  await expect(countQuestion(page)).toBeVisible()

  await countQuestion(page).getByRole('button', { name: 'Not now' }).click()
  await expect(
    page.getByText('Nothing changes. The question stays away for four weeks.'),
  ).toBeVisible()
  expect(((await api.get('/profile')) as { strengthPreference: number }).strengthPreference).toBe(2)

  // the day is kept in this browser: the question stays away on a reload, 27 days later ...
  const key = 'strength-prompt:count-not-now'
  expect(await page.evaluate((name) => localStorage.getItem(name), key)).toBe(today)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Next session' })).toBeVisible()
  await expect(countQuestion(page)).toBeHidden()
  await page.evaluate((entry) => localStorage.setItem(entry.name, entry.day), {
    name: key,
    day: addDays(today, -27),
  })
  await page.reload()
  await expect(page.getByRole('region', { name: 'Next session' })).toBeVisible()
  await expect(countQuestion(page)).toBeHidden()

  // ... and back after 28
  await page.evaluate((entry) => localStorage.setItem(entry.name, entry.day), {
    name: key,
    day: addDays(today, -28),
  })
  await page.reload()
  await expect(countQuestion(page)).toBeVisible()
})

test('"Plan 1 a week" changes the Profile choice only, for the next weekly update', async ({
  page,
  baseURL,
}) => {
  const { api } = await startDay(page, baseURL)
  await saveStrengthSetup(api)
  await seedUnloggedStrengthWeeks()
  const planBefore = (await api.get('/plan')) as PlanWithSessions
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/strength')
  await countQuestion(page).getByRole('button', { name: 'Plan 1 a week' }).click()
  await expect(
    page.getByText('From the next weekly update the plan asks for one strength session a week.'),
  ).toBeVisible()
  expect(((await api.get('/profile')) as { strengthPreference: number }).strengthPreference).toBe(1)
  // the plan itself is the weekly update's to change, as a revision the runner can read and undo
  const planAfter = (await api.get('/plan')) as PlanWithSessions
  expect(planAfter.sessions.filter((item) => item.kind === 'strength')).toHaveLength(
    planBefore.sessions.filter((item) => item.kind === 'strength').length,
  )
})
