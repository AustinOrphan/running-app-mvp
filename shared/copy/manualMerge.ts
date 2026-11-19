// The words of the manual merge (MM1): "Same session as…" on the activity page, the picker, the
// confirm step, the note on a merged copy and the refusals the server answers with a 409. A merge
// is the runner's say-so that two entries are one session; the device copy stays the record and
// the other is not counted, as for a pair the pass confirmed.
import type { MergeRefusal } from '../domain/manualMerge.ts'
import type { Units } from '../types.ts'
import { render, tpl, type Template } from './template.ts'

export const MANUAL_MERGE_TEMPLATES = {
  'merge.action': tpl('Same session as…', {}, { shape: 'label' }),
  'merge.picker.title': tpl('Which entry is the same session?', {}, { shape: 'sentence' }),
  'merge.picker.lead': tpl(
    'Choose the other entry of this session. The two then count once.',
    {},
    { shape: 'sentence' },
  ),
  'merge.picker.empty.run': tpl('No other run within a day of this one.'),
  'merge.picker.empty.strength': tpl('No other strength session within a day of this one.'),
  'merge.picker.error': tpl('The other entries did not load. Try again.'),
  'merge.confirm.title': tpl('Merge these two entries?', {}, { shape: 'sentence' }),
  'merge.confirm.stays': tpl(
    '{kept} stays as the record, with its own time and heart rate.',
    { kept: 'text' },
    { fallback: 'One entry stays as the record.' },
  ),
  'merge.confirm.moves': tpl(
    '{dropped} is not counted. Its plan session, fuel log and strength log move to the record.',
    { dropped: 'text' },
    { fallback: 'The other entry is not counted.' },
  ),
  'merge.confirm.copied': tpl(
    'Your rating, feel, pain, notes, heat mark and race result are copied to the record where it has none.',
  ),
  'merge.confirm.undo': tpl(
    'Separate on the merged entry counts it again. Logs that moved stay on the record.',
  ),
  'merge.confirm.merge': tpl('Merge', {}, { shape: 'label' }),
  'merge.confirm.back': tpl('Back', {}, { shape: 'label' }),
  'merge.confirm.error': tpl(
    'Not merged. {reason} Try again.',
    { reason: 'text' },
    { fallback: 'Not merged. Try again.' },
  ),
  'merge.merged-into': tpl('Merged into', {}, { shape: 'label' }),
  'merge.merged-into.other': tpl('the other entry', {}, { shape: 'label' }),
  // Item 7: a merged copy shows no rating form or sets; the record holds them.
  'merge.unavailable.note': tpl('To rate it or log sets, open the record it was paired with.'),
  'merge.not-counted': tpl('It is not counted in totals.'),
  'merge.separate': tpl('Separate', {}, { shape: 'label' }),
  'merge.separate.note': tpl(
    'Separate counts this entry again. Logs that moved to the record stay there.',
  ),
  'merge.separate.error': tpl(
    'Not separated. {reason} Try again.',
    { reason: 'text' },
    { fallback: 'Not separated. Try again.' },
  ),
  'merge.toast.merged': tpl('Merged', {}, { shape: 'label' }),
  'merge.toast.separated': tpl('Separated', {}, { shape: 'label' }),
  'merge.refuse.same': tpl('An activity cannot be merged with itself.'),
  'merge.refuse.kind': tpl(
    'Only a run with a run, or a strength session with a strength session, can be merged.',
  ),
  'merge.refuse.days': tpl('Only entries dated within a day of each other can be merged.'),
  // Both entries hold a log of one kind, and an activity holds one: the copy's would stay on a row
  // that no longer counts, so nothing is merged until the runner removes one.
  'merge.refuse.sets': tpl('Both entries have sets logged. Remove one set log first.'),
  'merge.refuse.fuel': tpl('Both entries have a fuel log. Remove one fuel log first.'),
  'merge.refuse.copy': tpl(
    'One of these entries is already merged into another activity. Separate it first.',
  ),
} satisfies Record<string, Template>

const T = MANUAL_MERGE_TEMPLATES

/** Words carry no unit. */
const UNITS: Units = 'km'

/** The sentence the server answers a refused merge with. */
export function mergeRefusalText(reason: MergeRefusal): string {
  return render(T[`merge.refuse.${reason}`], {}, UNITS)
}

/** "No other run within a day of this one." for the picker with nothing to offer. */
export function mergeEmptyText(kind: 'run' | 'strength'): string {
  return render(T[`merge.picker.empty.${kind}`], {}, UNITS)
}

/** The confirm step's lines: which entry stays, what moves off the other, and what is copied. */
export function mergeConfirmLines(kept: string, dropped: string): [string, string, string] {
  return [
    render(T['merge.confirm.stays'], { kept }, UNITS),
    render(T['merge.confirm.moves'], { dropped }, UNITS),
    render(T['merge.confirm.copied'], {}, UNITS),
  ]
}

/** "Not merged. <reason> Try again." for a failed merge, with the server's own sentence. */
export function mergeFailedText(reason: string): string {
  return render(T['merge.confirm.error'], { reason }, UNITS)
}

/** "Not separated. <reason> Try again." */
export function separateFailedText(reason: string): string {
  return render(T['merge.separate.error'], { reason }, UNITS)
}

/** A shorthand for a page: a label by id. */
export function mergeLabel(
  id:
    | 'merge.action'
    | 'merge.picker.title'
    | 'merge.picker.lead'
    | 'merge.picker.error'
    | 'merge.confirm.title'
    | 'merge.confirm.undo'
    | 'merge.confirm.merge'
    | 'merge.unavailable.note'
    | 'merge.confirm.back'
    | 'merge.merged-into'
    | 'merge.merged-into.other'
    | 'merge.not-counted'
    | 'merge.separate'
    | 'merge.separate.note'
    | 'merge.toast.merged'
    | 'merge.toast.separated',
): string {
  return render(T[id], {}, UNITS)
}
