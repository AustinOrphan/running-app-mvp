// The words of the Settings page. Every setting saves the moment it is changed, so the page has one
// confirmation and two refusals; `SETTINGS_TEMPLATES` is spread into `TEMPLATES`, so the G5 lint
// renders each one.
import { tpl } from './template.ts'

export const SETTINGS_TEMPLATES = {
  'settings.saved': tpl('Saved', {}, { shape: 'label' }),
  'settings.not-saved': tpl('Not saved. The server did not accept the change; try again.'),
  'settings.name-not-saved': tpl(
    'Not saved. The name stays in the field; change it or leave the field to try again.',
  ),
  'settings.name-alert': tpl('Display name not saved.'),
} as const
