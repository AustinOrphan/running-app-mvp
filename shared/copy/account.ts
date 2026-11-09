// The words of the account screens: the setup page, the Password block of Settings and the screen
// that asks for a new password after a first sign-in. `ACCOUNT_TEMPLATES` is spread into
// `TEMPLATES`, so the G5 lint renders each one.
import { tpl } from './template.ts'

export const ACCOUNT_TEMPLATES = {
  'account.setup.intro': tpl(
    'Create the first account of this install. The owner of the server adds anyone else.',
  ),
  'account.password.heading': tpl('Password', {}, { shape: 'label' }),
  'account.password.rules': tpl(
    'Use at least 12 characters (72 bytes at most), and not the password you have now.',
  ),
  'account.password.submit': tpl('Change password', {}, { shape: 'label' }),
  'account.password.mismatch': tpl('The two new passwords do not match.'),
  'account.password.changed': tpl('Password changed. Other devices are signed out.'),
  'account.password.too-many': tpl('Too many attempts. Try again in a few minutes.'),
  'account.password.not-changed': tpl(
    'The password was not changed. The server did not respond; try again.',
  ),
  'account.password.forced-title': tpl('Choose your password', {}, { shape: 'label' }),
  'account.password.forced-intro': tpl(
    'You signed in with a temporary password. Choose your own to continue.',
  ),
} as const
