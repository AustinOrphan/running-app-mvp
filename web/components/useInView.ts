import { useEffect, useRef, useState, type RefObject } from 'react'

/** How far below the viewport a sentinel counts as "in view", so content is ready before it scrolls in. */
const LOOKAHEAD = '240px 0px'

/**
 * Whether the element behind the returned ref has come near the viewport. It turns true once and
 * stays true, so a section that has loaded does not unload again. Without `IntersectionObserver`
 * (an old browser) the element counts as in view at once.
 */
export function useInView<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const element = ref.current
    if (seen || element === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
      },
      { rootMargin: LOOKAHEAD },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [seen])

  return [ref, seen]
}
