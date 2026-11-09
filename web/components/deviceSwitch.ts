import { useCallback, useSyncExternalStore } from 'react'

/**
 * A device setting that is a switch, kept in `localStorage` under `key` as `on` or `off` (the theme
 * and the Condensed figures switch work the same way; nothing about it reaches the server). Nothing
 * stored reads as `defaultOn`; a blocked or unreadable store reads as `defaultOn` too, and a choice
 * made where storage cannot be written still holds for the life of the page.
 */
export function createDeviceSwitch(
  key: string,
  defaultOn: boolean,
): () => { on: boolean; setOn: (next: boolean) => void } {
  const listeners = new Set<() => void>()
  // `blockedChoice` is read while the last write failed, or while reading throws.
  let blockedChoice = defaultOn
  let writeFailed = false

  function snapshot(): boolean {
    if (writeFailed) return blockedChoice
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? defaultOn : stored === 'on'
    } catch {
      return blockedChoice
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    // another tab changing the switch
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) listener()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(listener)
      window.removeEventListener('storage', onStorage)
    }
  }

  return function useDeviceSwitch() {
    const on = useSyncExternalStore(subscribe, snapshot, () => defaultOn)
    const setOn = useCallback((next: boolean) => {
      try {
        localStorage.setItem(key, next ? 'on' : 'off')
        writeFailed = false
      } catch {
        writeFailed = true
        blockedChoice = next
      }
      for (const listener of listeners) listener()
    }, [])
    return { on, setOn }
  }
}
