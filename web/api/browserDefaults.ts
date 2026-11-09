import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { unitsForLocale } from '../../shared/domain/locale.ts'
import { isValidTimezone } from '../../shared/domain/timezone.ts'
import type { SessionUser, Units, UserSettings, WeightUnit } from '../../shared/types.ts'
import { api, keys } from './client.ts'

interface BrowserDefaults {
  units: Units
  weightUnit: WeightUnit
  timezone: string
}

/** What this browser says about its runner: the units its locale implies and its time zone. */
export function readBrowserDefaults(): BrowserDefaults {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return {
    ...unitsForLocale(typeof navigator === 'undefined' ? undefined : navigator.language),
    timezone: zone !== '' && isValidTimezone(zone) ? zone : 'UTC',
  }
}

/**
 * The first load of an account that the owner made without units or a zone: sends what the browser
 * knows, once, with no prompt. The server applies each value only while its flag is set and clears
 * the flag, so a runner's later choice is never overwritten. One attempt per page load; a failed one
 * is made again at the next.
 */
export function useBrowserDefaults(user: SessionUser | null | undefined): void {
  const queryClient = useQueryClient()
  const sent = useRef(false)
  const apply = useMutation({
    mutationFn: (defaults: BrowserDefaults) =>
      api<UserSettings>('POST', '/settings/browser-defaults', defaults),
    onSuccess: () =>
      Promise.all(
        [keys.me, keys.settings, keys.profile, keys.today, keys.strength].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  })
  const pending =
    user != null && !user.mustChangePassword && (user.unitsFromBrowser || user.zoneFromBrowser)
  const { mutate } = apply
  useEffect(() => {
    if (!pending || sent.current) return
    sent.current = true
    mutate(readBrowserDefaults())
  }, [pending, mutate])
}
