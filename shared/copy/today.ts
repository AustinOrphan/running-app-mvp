// Today's sentences (phase 3a design, section 7.6): the readiness verdict, the signals behind it,
// the race countdown and the names of the week strip's days. They are spread into `TEMPLATES`, so
// the copy-lint test renders every one of them. The engine hands over a template id and its slots
// (`readinessVerdict`, `readinessSignals`); `renderFact` writes the words in the runner's units.
//
// Ids are `today.<group>.<name>`. Each id below is built in `shared/engine/readiness.ts`, where a
// `TemplateId` type keeps the two in step.
import type { Quantity } from '../engine/types.ts'
import { roundEstimateSec } from '../units.ts'
import { tpl, type Template } from './template.ts'

export const TODAY_TEMPLATES = {
  // The verdict: one line on what readiness means for today.
  'today.verdict.ready': tpl('Ready as planned.'),
  'today.verdict.low-stays': tpl(
    "Signals are a little low. Today's session is already easy, so it stays.",
  ),
  // Low signals on a day with a harder run (long, race, hike) or with no run at all.
  'today.verdict.low-plan-stays': tpl('Signals are a little low. The plan stays as it is.'),
  'today.verdict.easy': tpl('An easy run is the better choice today.'),
  'today.verdict.rest': tpl('A rest day is the better choice today.'),
  'today.verdict.lighter-week': tpl(
    'Recent signals have stayed low for several days. A lighter week may help.',
  ),
  'today.verdict.no-signals': tpl('No readiness signals yet. One tap below adds the first.'),

  // The signals: the two or three readings behind the verdict.
  'today.signal.illness-rest': tpl(
    'Illness was reported: rest until a symptom-free day has passed.',
  ),
  'today.signal.illness-easy': tpl('Returning from illness: easy running only for now.'),
  'today.signal.pain': tpl('Pain of {score} out of 10 was reported.', { score: 'count' }),
  'today.signal.pain-bone': tpl('Focal bone pain was reported.'),
  'today.signal.hrv': tpl('HRV is {latest} ms. Your usual range is {low} to {high} ms.', {
    latest: 'count',
    low: 'count',
    high: 'count',
  }),
  'today.signal.hrv-low': tpl(
    'HRV has dropped to {latest} ms. Your usual range is {low} to {high} ms.',
    { latest: 'count', low: 'count', high: 'count' },
  ),
  'today.signal.hrv-building': tpl(
    'Building your usual HRV range ({readings} of {needed} readings).',
    { readings: 'count', needed: 'count' },
  ),
  'today.signal.resting-hr': tpl('Resting heart rate is {latest}. Your usual is about {usual}.', {
    latest: 'bpm',
    usual: 'bpm',
  }),
  'today.signal.resting-hr-high': tpl(
    'Resting heart rate is {latest}, {above} above your usual {usual}.',
    { latest: 'bpm', above: 'bpm', usual: 'bpm' },
  ),
  'today.signal.resting-hr-only': tpl('Resting heart rate is {latest}.', { latest: 'bpm' }),
  'today.signal.sleep': tpl('Sleep averaged {hours} across {nights} recent nights.', {
    hours: 'duration',
    nights: 'count',
  }),
  'today.signal.sleep-low': tpl(
    'Sleep averaged {hours} across {nights} recent nights, under {floor}.',
    { hours: 'duration', nights: 'count', floor: 'duration' },
  ),
  // One template per answer of the fatigue row (Fresh, Good, Normal, Tired, Drained), so no word
  // is picked in code.
  'today.signal.checkin-fresh': tpl('Check-in: feeling fresh.'),
  'today.signal.checkin-good': tpl('Check-in: feeling good.'),
  'today.signal.checkin-normal': tpl('Check-in: feeling normal.'),
  'today.signal.checkin-tired': tpl('Check-in: feeling tired.'),
  'today.signal.checkin-drained': tpl('Check-in: feeling drained.'),
  'today.signal.checkin-items': tpl('Check-in recorded today.'),
  'today.signal.checkin-items-low': tpl('Some check-in answers are away from normal today.'),

  // The check-in row (E2-6): the question, the five answers of the fatigue scale, the line the row
  // folds into and, when the connection is down, the same line saying where the answer is kept.
  // One template per answer, so no word is picked in code.
  'today.checkin.question': tpl('How do you feel today?'),
  'today.checkin.answer-fresh': tpl('Fresh', {}, { shape: 'label' }),
  'today.checkin.answer-good': tpl('Good', {}, { shape: 'label' }),
  'today.checkin.answer-normal': tpl('Normal', {}, { shape: 'label' }),
  'today.checkin.answer-tired': tpl('Tired', {}, { shape: 'label' }),
  'today.checkin.answer-drained': tpl('Drained', {}, { shape: 'label' }),
  'today.checkin.sent-fresh': tpl('Checked in: fresh.'),
  'today.checkin.sent-good': tpl('Checked in: good.'),
  'today.checkin.sent-normal': tpl('Checked in: normal.'),
  'today.checkin.sent-tired': tpl('Checked in: tired.'),
  'today.checkin.sent-drained': tpl('Checked in: drained.'),
  'today.checkin.queued-fresh': tpl('Checked in: fresh. Saved on this phone.'),
  'today.checkin.queued-good': tpl('Checked in: good. Saved on this phone.'),
  'today.checkin.queued-normal': tpl('Checked in: normal. Saved on this phone.'),
  'today.checkin.queued-tired': tpl('Checked in: tired. Saved on this phone.'),
  'today.checkin.queued-drained': tpl('Checked in: drained. Saved on this phone.'),
  // What the verdict says in place of "One tap below adds the first." once an answer is waiting on
  // the phone: the server has no signal yet, and the row below has already been used.
  'today.checkin.verdict-queued': tpl(
    'Your check-in is saved on this phone. Readiness is read again once it is sent.',
  ),
  // The check-in sheet: the caption of the five scales, the pain scale's hint and the toast that
  // says where a save ended up.
  'today.checkin.sheet-new': tpl(
    'Optional. 1 to 5, where 3 is normal. These answers come first when the plan checks readiness.',
  ),
  'today.checkin.sheet-saved': tpl('Saved for today. Change any answer and save again.'),
  'today.checkin.pain-hint': tpl('0 is none, 10 is the worst.'),
  'today.checkin.toast-sent': tpl('Check-in saved', {}, { shape: 'label' }),
  'today.checkin.toast-queued': tpl('Check-in saved on this phone', {}, { shape: 'label' }),
  // `reason` is the server's own sentence, quoted.
  'today.checkin.not-saved': tpl('Check-in not saved. {reason} Try again.', { reason: 'text' }),
  // The server no longer knows the session, so what was waiting on the phone is gone with it.
  'today.outbox.signed-out': tpl('You are signed out.'),
  // An entry the outbox sent later was refused by the server and removed from the phone.
  'today.outbox.dropped': tpl(
    'A {what} saved on this phone was not accepted and was removed. Enter it again if it still applies.',
    { what: 'text' },
  ),

  // A sheet whose code could not be loaded (no connection and no copy kept, or a release replaced
  // the file): the page itself still works.
  'today.sheet.unavailable-title': tpl('This did not open', {}, { shape: 'label' }),
  'today.sheet.unavailable': tpl(
    'This part of the app did not load. Reload the page to try again.',
  ),

  // The Done sheet: the planned figures are the prefill, so the sentence says to change what
  // differs. A session of another kind than a run is logged as the same activity it will link to.
  'today.done.title-run': tpl("Log today's run", {}, { shape: 'label' }),
  'today.done.title-session': tpl("Log today's session", {}, { shape: 'label' }),
  'today.done.planned': tpl('Planned: {duration}, {distance}. Change anything that differs.', {
    duration: 'minutes',
    distance: 'text',
  }),
  'today.done.planned-time': tpl('Planned: {duration}. Change anything that differs.', {
    duration: 'minutes',
  }),
  'today.done.offline': tpl('Needs a connection. Your entries stay on this phone.'),
  'today.done.saved-run': tpl('Run saved', {}, { shape: 'label' }),
  'today.done.saved-session': tpl('Session saved', {}, { shape: 'label' }),
  'today.done.not-saved': tpl('Not saved. {reason} Your entries are still here; try again.', {
    reason: 'text',
  }),

  // The race countdown.
  'today.race.estimate': tpl('Finish estimate {low} to {high}, most likely about {likely}.', {
    low: 'duration',
    high: 'duration',
    likely: 'duration',
  }),
  'today.race.wide': tpl(
    'The range is wide on purpose. Predictions for {distance} rest on thin evidence (grade {grade}).',
    { distance: 'distance', grade: 'text' },
  ),

  // The notes of the data-health block that come from the job log (spec 4.7 and 7.4).
  'today.health.sync-paused': tpl(
    "Sync is paused to stay within the service's limits, and picks up again on its own.",
  ),
  'today.health.update-not-run': tpl("This week's plan update has not run yet."),

  // The days of the week strip, as their accessible names.
  'today.week.done': tpl('Done', {}, { shape: 'label' }),
  'today.week.partial': tpl('Partly done', {}, { shape: 'label' }),
  'today.week.skipped': tpl('Skipped', {}, { shape: 'label' }),
  'today.week.planned': tpl('Planned', {}, { shape: 'label' }),
  'today.week.unlogged': tpl('Planned, no run logged', {}, { shape: 'label' }),
  'today.week.free': tpl('No run planned', {}, { shape: 'label' }),
  // A day as a screen reader names it: the date, its mark and the run time logged on it.
  'today.week.day': tpl(
    '{weekday} {date}, {mark}',
    { weekday: 'weekday', date: 'date', mark: 'text' },
    { shape: 'label' },
  ),
  'today.week.day-logged': tpl(
    '{weekday} {date}, {mark}, {logged} logged',
    { weekday: 'weekday', date: 'date', mark: 'text', logged: 'minutes' },
    { shape: 'label' },
  ),
  // The advisory split of what is left of the week's target. Advice, not a minimum.
  'today.week.advisory': tpl(
    '{perDay} a day left, through Sunday',
    { perDay: 'minutes' },
    { shape: 'label' },
  ),
  'today.week.nothing-left': tpl('Nothing left to plan this week', {}, { shape: 'label' }),
  'today.week.advisory-caption': tpl('advisory', {}, { shape: 'label' }),

  // The targets of the session, as the hero's term list reads them: a term, its value and, when
  // the day calls for it, a note. The order of the terms follows the lead (`resolveTargets`).
  'today.target.term-hr': tpl('Heart rate', {}, { shape: 'label' }),
  'today.target.term-pace': tpl('Pace', {}, { shape: 'label' }),
  'today.target.term-effort': tpl('Effort', {}, { shape: 'label' }),
  'today.target.hr-ceiling': tpl('under {limit}', { limit: 'bpm' }, { shape: 'label' }),
  // A range prints its unit once ("149 to 165 bpm"), so it arrives as text.
  'today.target.range': tpl('{range}', { range: 'text' }, { shape: 'label' }),
  'today.target.pace-guide': tpl('about {range}', { range: 'text' }, { shape: 'label' }),
  'today.target.effort': tpl('{range} out of 10', { range: 'text' }, { shape: 'label' }),
  'today.target.note-pace-guide': tpl('Effort and heart rate come first.'),
  'today.target.note-hot-effort': tpl('Go by this today.'),
  'today.target.note-hot-hr': tpl('It runs high in heat.'),

  // The cooler start: the hour, and the index then and at the peak. Without a WBGT reading the
  // peak figure is not known, so the air-temperature line names the cooler hour only.
  'today.cooler.wbgt': tpl('Cooler start: {time}. WBGT about {then} then, {peak} around {hour}.', {
    time: 'text',
    then: 'temp',
    peak: 'temp',
    hour: 'text',
  }),
  'today.cooler.air': tpl('Cooler start: {time}. Air temperature about {then} then.', {
    time: 'text',
    then: 'temp',
  }),

  // The hero: what was planned when the day is eased or rested, the run that was logged, the
  // day's other sessions and the next one.
  'today.hero.planned': tpl(
    'Planned: {title}, {duration}',
    { title: 'text', duration: 'minutes' },
    { shape: 'label' },
  ),
  'today.hero.planned-not-today': tpl('Planned: {title}, {duration}. Not today.', {
    title: 'text',
    duration: 'minutes',
  }),
  'today.hero.rest-day': tpl('Rest day.'),
  // The distance of a run arrives as text, written by `formatDistance` (5.00 mi), as the log and
  // the session sheet write it.
  'today.hero.logged': tpl('Logged: {distance} in {duration}.', {
    distance: 'text',
    duration: 'duration',
  }),
  'today.hero.logged-time': tpl('Logged: {duration}.', { duration: 'duration' }),
  'today.hero.also': tpl('Also today: {sessions}.', { sessions: 'text' }),
  'today.hero.nothing-planned': tpl('Nothing is planned today.'),
  'today.hero.next': tpl('Next: {date}, {title}, {duration}.', {
    date: 'date',
    title: 'text',
    duration: 'minutes',
  }),
  'today.hero.climb': tpl('{climb} climb', { climb: 'climb' }, { shape: 'label' }),
} satisfies Record<string, Template>

/**
 * The slots of `today.race.estimate`: the range and its middle at the precision `formatEstimate`
 * uses, so the sentence and any table beside it read the same.
 */
export function raceEstimateSlots(prediction: {
  lowSec: number
  highSec: number
  predictedSec: number
}): { low: Quantity; high: Quantity; likely: Quantity } {
  const duration = (sec: number): Quantity => ({ kind: 'duration', sec: roundEstimateSec(sec) })
  return {
    low: duration(prediction.lowSec),
    high: duration(prediction.highSec),
    likely: duration(prediction.predictedSec),
  }
}
