/** True when `name` is an IANA time zone the runtime knows (`Europe/London`, `UTC`). */
export function isValidTimezone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name })
    return true
  } catch {
    return false
  }
}
