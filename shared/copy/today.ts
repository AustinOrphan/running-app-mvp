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
  // A day with no run to do (a rest day, or nothing planned) and normal signals: "Ready as planned."
  // would sit over "Nothing is planned today." and read as a contradiction.
  'today.verdict.ready-no-session': tpl('Signals are normal. The plan stays as it is.'),
  'today.verdict.easy': tpl('An easy run is the better choice today.'),
  'today.verdict.rest': tpl('A rest day is the better choice today.'),
  'today.verdict.lighter-week': tpl(
    'Recent signals have stayed low for several days. A lighter week may help.',
  ),
  'today.verdict.no-signals': tpl('No readiness signals yet. One tap below adds the first.'),
  // While a window is open the band states it, and the verdict names the day instead of "Ready as
  // planned." (`windowVerdict`): a rest day, a day of limited running, the easy tail, the return
  // week. Each is a state of the day, so none repeats the window's dates or limits.
  'today.verdict.window-rest': tpl('The window keeps today at rest.'),
  'today.verdict.window-limited': tpl('A day of limited running.'),
  'today.verdict.window-easy': tpl('Easy running only today.'),
  'today.verdict.window-return': tpl('A day of the return week.'),

  // The signals: the two or three readings behind the verdict.
  // {free} is the n-3 wait in words ("one symptom-free day"), written from the Param.
  'today.signal.illness-rest': tpl('Illness was reported: rest until you have had {free}.', {
    free: 'text',
  }),
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

  // The red-flag notes under the verdict and the reasons beside an eased session. Each states the
  // number of days a rule waits, so the engine fills it from the Param, as words ("three days").
  'today.note.illness-rest': tpl(
    'Illness was reported. Intensity is suspended; easy running resumes after {free}.',
    { free: 'text' },
  ),
  'today.note.illness-return': tpl(
    'Returning from illness. Keep to easy running for {easy} before any intensity.',
    { easy: 'text' },
  ),
  'today.reason.illness-return': tpl('Returning from illness: easy running only for {easy}.', {
    easy: 'text',
  }),
  'today.reason.masters': tpl(
    'Soreness, fatigue or motivation is still worse than your usual {wait} after a hard session.',
    { wait: 'text' },
  ),

  // The check-in row (E2-6): the question, the five answers of the fatigue scale, the line the row
  // folds into and, when the connection is down, the same line saying where the answer is kept.
  // One template per answer, so no word is picked in code.
  'today.checkin.question': tpl('How do you feel today?'),
  // The second button of the row. While a window is open the plan already knows about the illness
  // or the pain, so the button reads as what it then does: it adds another window.
  'today.checkin.hurt': tpl("Something hurts, or I'm ill", {}, { shape: 'label' }),
  'today.checkin.hurt-window': tpl('Add a pain or illness window', {}, { shape: 'label' }),
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
  'today.checkin.sheet-saved': tpl(
    'Saved for today. 3 is normal. Change any answer and save again.',
  ),
  'today.checkin.pain-hint': tpl('0 is none, 10 is the worst.'),
  // The end labels of the five scales, so the direction is never a guess. Soreness, fatigue and
  // stress rise when things are worse; sleep and mood fall (readiness reads them that way).
  'today.checkin.scale-fatigue': tpl('1 fresh, 5 drained.'),
  'today.checkin.scale-soreness': tpl('1 none, 5 very sore.'),
  'today.checkin.scale-sleep': tpl('1 poor, 5 good.'),
  'today.checkin.scale-mood': tpl('1 low, 5 good.'),
  'today.checkin.scale-stress': tpl('1 calm, 5 very stressed.'),
  'today.checkin.pain-area-hint': tpl('Optional. Where it hurts, in a few words.'),
  'today.checkin.bone-hint': tpl(
    'Tick this if pressing on one spot of a bone hurts. Progression then holds until a later check-in clears it.',
  ),
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
  // An entry that kept failing was moved behind the others; it stays on the phone.
  'today.outbox.parked': tpl(
    'A {what} saved on this phone has not gone up after several tries. It stays here and is sent again later.',
    { what: 'text' },
  ),
  // The control that clears such a notice when nothing the runner does next clears it by itself
  // (a strength log refused on replay, design 9.6).
  // The same, for a write whose refusal is worth quoting (a run or a rating): `reason` is the
  // server's own sentence.
  'today.outbox.dropped-why': tpl(
    'A {what} saved on this phone was not added. {reason} Enter it again if it still applies.',
    { what: 'text', reason: 'text' },
  ),
  // Settings, before signing out with a run or rating that has not gone up (a sign-out clears it).
  'today.signout-waiting': tpl('Not yet sent from this phone: {what}. Signing out clears it.', {
    what: 'text',
  }),
  'today.signout-anyway': tpl('Sign out anyway', {}, { shape: 'label' }),
  'today.signout-cancel': tpl('Cancel', {}, { shape: 'label' }),
  'today.outbox.dismiss': tpl('Dismiss', {}, { shape: 'label' }),

  // A sheet whose code could not be loaded (no connection and no copy kept, or a release replaced
  // the file): the page itself still works.
  'today.sheet.unavailable-title': tpl('This did not open', {}, { shape: 'label' }),
  'today.sheet.unavailable': tpl(
    'This part of the app did not load. Try again, or reload the page.',
  ),

  // Offline (E2-8, ADR 0012): the line above Today while the numbers on screen are the phone's
  // copy. The time is the hour the server composed the payload, in the server's zone. The date is
  // the day it was composed: named when that is not the day on screen (a preview of the day made
  // the evening before), and for a copy of a day that is over.
  'today.offline.saved': tpl(
    'Offline. Showing the session saved at {time}.',
    { time: 'text' },
    { fallback: 'Offline. Showing the session saved on this phone.' },
  ),
  'today.offline.saved-earlier': tpl(
    'Offline. Showing the session saved on {date} at {time}.',
    { date: 'date', time: 'text' },
    { fallback: 'Offline. Showing the session saved earlier on this phone.' },
  ),
  'today.offline.older': tpl(
    "Offline. This session was saved on {date}. Today's is not loaded yet.",
    { date: 'date' },
    { fallback: "Offline. This session was saved earlier. Today's is not loaded yet." },
  ),
  // Settings: whether the installed app can open with no connection, and when it cannot, why. A
  // worker runs only on https or localhost, in a browser that has workers, in a production build.
  'today.offline.use-ready': tpl('Offline use: ready.'),
  'today.offline.use-installing': tpl('Offline use: installing.'),
  'today.offline.use-no-https': tpl('Offline use: not available (needs https).'),
  'today.offline.use-unsupported': tpl(
    'Offline use: not available (this browser does not support it).',
  ),
  'today.offline.use-refused': tpl('Offline use: not available (the browser did not allow it).'),
  'today.offline.use-development': tpl(
    'Offline use: not available (this is not a production build).',
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
  'today.done.offline': tpl(
    'No connection. Save keeps this on the phone and sends it when you are back online.',
  ),
  'today.done.saved-run': tpl('Run saved', {}, { shape: 'label' }),
  'today.done.saved-session': tpl('Session saved', {}, { shape: 'label' }),
  // The toast's one action: the page of the entry just saved.
  'today.done.see-run': tpl('See the run', {}, { shape: 'label' }),
  'today.done.see-session': tpl('See the session', {}, { shape: 'label' }),
  // The server's answer when the session was already marked done (another phone, or a sync).
  'today.done.already-logged': tpl(
    'This session already has a run logged, so the one from this phone was not added.',
  ),
  // Shown on Today while a Done waits in the outbox, and as the toast when it is queued.
  'today.done.queued': tpl('Saved on this phone. It goes up as soon as the server can be reached.'),
  // The quiet line in the session card while that Done waits (the toast says the long version once).
  'today.done.waiting': tpl('Saved on this phone, waiting to go up.'),
  // The toast when a queued write reaches the server.
  'today.done.sent-later': tpl('The run saved on this phone has gone up.'),
  'today.rate.sent-later': tpl('The rating saved on this phone has gone up.'),
  'today.rate.queued': tpl(
    'Rating saved on this phone. It goes up as soon as the server can be reached.',
  ),
  // The quiet line where the rating form was while it waits (the toast says the long version once).
  'today.rate.waiting': tpl('Rating saved on this phone, waiting to go up.'),
  'today.done.not-saved': tpl('Not saved. {reason} Your entries are still here; try again.', {
    reason: 'text',
  }),

  // Check for new runs (the control in Today's header). `source` is the name of the service or
  // services that answered, written by the caller from their labels.
  'today.check.label': tpl('Check for new runs', {}, { shape: 'label' }),
  'today.check.busy': tpl('Checking for new runs.'),
  'today.check.arrived-one': tpl(
    'One new run added from {source}',
    { source: 'text' },
    { shape: 'label' },
  ),
  'today.check.arrived-many': tpl(
    '{count} new runs added from {source}',
    { count: 'count', source: 'text' },
    { shape: 'label' },
  ),
  'today.check.none': tpl('No new runs', {}, { shape: 'label' }),
  // `reason` is the service's or the server's own sentence, quoted.
  'today.check.failed': tpl('Could not check {source}. {reason} Try again.', {
    source: 'text',
    reason: 'text',
  }),
  'today.check.partial': tpl('{source} did not finish. {reason} Try again later.', {
    source: 'text',
    reason: 'text',
  }),
  'today.check.slow': tpl('{source} has not answered yet. Its runs show once it does.', {
    source: 'text',
  }),
  'today.check.slow-many': tpl('{source} have not answered yet. Their runs show once they do.', {
    source: 'text',
  }),

  // Monday on Today: while the weekly update's brief is unopened and it changed sessions, a card
  // stands under the session hero (`MondayBrief`), and a review that is due gets its own link beside it.
  'today.monday.title': tpl('The plan was updated', {}, { shape: 'label' }),
  'today.monday.review': tpl('Review last week', {}, { shape: 'label' }),
  'today.monday.review-note': tpl('A few answers keep the next update accurate.'),

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
  // The notes about a source that delivers runs (rule J10). Neither says that a run was not made:
  // the second asks, and says that nothing is needed when there was no run.
  'today.health.source-needs-auth': tpl(
    '{source} needs signing in again; runs since then have not arrived.',
    { source: 'text' },
    { fallback: 'A source needs signing in again; runs since then have not arrived.' },
  ),
  'today.health.source-silent': tpl(
    'No run has arrived from {source} since {since}. If you ran, check the upload; if you did not, nothing is needed.',
    { source: 'text', since: 'date' },
    {
      fallback:
        'No run has arrived from a source for several days. If you ran, check the upload; if you did not, nothing is needed.',
    },
  ),

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
  // What the plan holds for the rest of the week, as a description (`plannedRestOfWeekMin`), never
  // what the target would take. It is left out while a window is open, on a rest day and when the
  // verdict is an easy day, a rest day or a lighter week (`showWeekAdvisory`).
  'today.week.rest-planned': tpl('Planned for the rest of the week: {total}.', {
    total: 'minutes',
  }),

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
  // The same note for a session on another day (the weekly brief, the session sheet), where
  // "today" would be wrong: it reads right for a day ahead and for a day that has passed.
  'today.target.note-hot-effort-day': tpl('Go by this when you run it.'),
  'today.target.note-hot-hr': tpl('It runs high in heat.'),

  // The cooler start: the hour, and the index then and at the peak. Without a WBGT reading the
  // peak figure is not known, so the air-temperature line names the cooler hour only. The WBGT is
  // a `temp` quantity (°C in either unit system); the air temperature arrives as text, written
  // by `formatAirTemperature`, which follows the units.
  'today.cooler.wbgt': tpl('Cooler start: {time}. WBGT about {then} then, {peak} around {hour}.', {
    time: 'text',
    then: 'temp',
    peak: 'temp',
    hour: 'text',
  }),
  'today.cooler.air': tpl('Cooler start: {time}. Air temperature about {then} then.', {
    time: 'text',
    then: 'text',
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
  // The rating ask under a logged run that has no rating yet (the hero's own, before the card of
  // older runs below).
  'today.rate.heading': tpl('Rate this run', {}, { shape: 'label' }),
  'today.rate.caption': tpl(
    'Optional. A rating of effort or feel is what lets the plan adjust. Rate any or all of it.',
  ),
  'today.rate.save': tpl('Save rating', {}, { shape: 'label' }),
  'today.rate.saved': tpl('Rating saved.'),
  'today.rate.not-saved': tpl('Rating not saved. {reason} Try again.', { reason: 'text' }),
  // The link under the figures of a session that has a run: the run's own page.
  'today.hero.see-run': tpl('See the run', {}, { shape: 'label' }),
  'today.hero.see-session': tpl('See the session', {}, { shape: 'label' }),
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
