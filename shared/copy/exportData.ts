// The words of the full-data export on the Settings page. `EXPORT_TEMPLATES` is spread into
// `TEMPLATES`, so the G5 lint renders each one.
import { tpl } from './template.ts'

export const EXPORT_TEMPLATES = {
  'export.button': tpl('Download all your data', {}, { shape: 'label' }),
  'export.included': tpl(
    'One ZIP file with every activity and its stream, your plans, logs, reviews, goals and settings, and the files you imported as they were uploaded.',
  ),
  'export.not-included': tpl(
    'It leaves out your password and the keys and tokens of connected sources.',
  ),
  'export.busy': tpl('Getting the download ready.'),
  'export.started': tpl(
    'Your download has started. A long history can take a minute to arrive; watch your browser’s downloads.',
  ),
  'export.running': tpl('An export is already running. Wait for it to finish, then try again.'),
  'export.rate': tpl('Too many requests just now. Try again in a few minutes.'),
  'export.too-big': tpl(
    'This history has more files than one archive can hold, so it cannot be downloaded in one piece.',
  ),
  'export.error': tpl('The download could not be started. Try again; nothing was changed.'),
} as const
