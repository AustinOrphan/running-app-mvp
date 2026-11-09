// The words of the account screens: the setup page and, with the password change, the Password
// block of Settings and the screen that asks for a new password after a first sign-in.
// `ACCOUNT_TEMPLATES` is spread into `TEMPLATES`, so the G5 lint renders each one.
import { tpl } from './template.ts'

export const ACCOUNT_TEMPLATES = {
  'account.setup.intro': tpl(
    'Create the first account of this install. The owner of the server adds anyone else.',
  ),
} as const
