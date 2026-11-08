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
  'export.busy': tpl(
    'Preparing the archive. A long history can take a minute; keep this page open.',
  ),
  'export.done': tpl('Archive downloaded.'),
  'export.running': tpl('An export is already running. Wait for it to finish, then try again.'),
  'export.error': tpl('The archive could not be made. Try again; nothing was changed.'),
} as const
