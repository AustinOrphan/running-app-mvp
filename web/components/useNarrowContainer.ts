import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Whether the element is narrower than `rem` rem, measured on the element itself (a container
 * query for markup that must change, not only style): the side rail takes 220 px from a 720 px
 * window, so the window's width says little about the room the content has. The answer is read
 * before the first paint and again whenever the element is resized. Without `ResizeObserver` the
 * element counts as wide.
 */
export function useNarrowContainer<T extends HTMLElement>(rem: number): [RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const limit = () =>
      rem * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
    const measure = (width: number) => {
      // A width of 0 is an element that is not laid out (hidden, or no layout engine): wide.
      setNarrow(width > 0 && width < limit())
    }
    measure(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) measure(entry.contentRect.width)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [rem])
  return [ref, narrow]
}
