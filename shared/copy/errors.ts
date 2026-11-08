// The words of `ErrorState`, the failed-load state beside `EmptyState`: one sentence naming what
// happened, one muted line, one button. `ERROR_TEMPLATES` is spread into `TEMPLATES`.
import { tpl } from './template.ts'

export const ERROR_TEMPLATES = {
  'error.load': tpl('{subject} did not load.', { subject: 'text' }),
  'error.load-hint': tpl('The server did not respond. Try again; nothing you saved is lost.'),
  'error.load-offline': tpl('{subject} needs a connection.', { subject: 'text' }),
  'error.load-offline-hint': tpl('This device is offline. Try again once it is back online.'),
  'error.retry': tpl('Try again', {}, { shape: 'label' }),
} as const
