// The words of `ErrorState`, the failed-load state beside `EmptyState`: one sentence naming what
// happened, one muted line, one button. `ERROR_TEMPLATES` is spread into `TEMPLATES`.
import { tpl } from './template.ts'

export const ERROR_TEMPLATES = {
  'error.load': tpl('{subject} did not load.', { subject: 'text' }),
  'error.load-hint': tpl('The server did not respond. Try again; nothing you saved is lost.'),
  'error.load-offline': tpl('{subject} needs a connection.', { subject: 'text' }),
  'error.load-offline-hint': tpl('This device is offline. Try again once it is back online.'),
  'error.retry': tpl('Try again', {}, { shape: 'label' }),
  // The error boundary (E1): a screen that threw while drawing. The runner can reload; where the
  // navigation still stands it says so.
  'error.crash': tpl('This screen hit a problem.'),
  'error.crash-hint': tpl('Reload to carry on.'),
  'error.crash-hint-nav': tpl('Reload to carry on, or open another tab.'),
  'error.crash-reload': tpl('Reload', {}, { shape: 'label' }),
} as const
