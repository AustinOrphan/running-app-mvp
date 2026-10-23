// The sentences of the Activities list (phase 3a design, 5.7): how much of the history is on the
// screen, the button for the next page and the note when a page did not load. The numbers are the
// server's `ActivityListPage.total` and the rows already read; the words are the templates below,
// spread into `TEMPLATES`.
import type { Units } from '../types.ts'
import { render, tpl, type Template } from './template.ts'

export const ACTIVITY_LIST_TEMPLATES = {
  // The count line: the whole list when everything is on the screen, else how much of it is.
  'activity-list.all.one': tpl('1 activity', {}, { shape: 'label' }),
  'activity-list.all.many': tpl(
    '{total} activities',
    { total: 'text' },
    { shape: 'label', fallback: 'Activities' },
  ),
  'activity-list.showing': tpl(
    'Showing {shown} of {total} activities',
    { shown: 'text', total: 'text' },
    { shape: 'label', fallback: 'Showing some of the activities' },
  ),
  'activity-list.more': tpl(
    'Show {n} more',
    { n: 'count' },
    { shape: 'label', fallback: 'Show more' },
  ),
  'activity-list.more-error': tpl('More activities did not load. Try again.'),
} satisfies Record<string, Template>

const T = ACTIVITY_LIST_TEMPLATES

/** Counts and the words around them read the same in either unit system. */
const UNITS: Units = 'km'

const grouped = new Intl.NumberFormat('en-US')

/** A whole count with thousands separators: 1,284. */
function groupedCount(n: number): string {
  return grouped.format(n)
}

/**
 * "1 activity" or "37 activities" when every row is on the screen, "Showing 50 of 1,284 activities"
 * when more wait on the server.
 */
export function activityCountText(shown: number, total: number): string {
  if (shown >= total) {
    return total === 1
      ? render(T['activity-list.all.one'], {}, UNITS)
      : render(T['activity-list.all.many'], { total: groupedCount(total) }, UNITS)
  }
  return render(
    T['activity-list.showing'],
    { shown: groupedCount(shown), total: groupedCount(total) },
    UNITS,
  )
}

/** The label of the button that adds the next page: "Show 50 more", or fewer on the last page. */
export function activityMoreLabel(n: number): string {
  return render(T['activity-list.more'], { n: { kind: 'count', n } }, UNITS)
}

export const ACTIVITY_MORE_ERROR = render(T['activity-list.more-error'], {}, UNITS)
