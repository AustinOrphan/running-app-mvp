import type { Units } from '../../../shared/types.ts'
import { useInView } from '../useInView.ts'
import { RecentStrip } from './RecentStrip.tsx'
import { RecentWeeks } from './RecentWeeks.tsx'

/**
 * The two history sections at the foot of Today. They read their own data (28 days of activities,
 * 12 weeks and the plan), which the coach payload does not carry, so nothing is requested until
 * the sentinel scrolls near the viewport and the first screen asks for the payload and the
 * settings only.
 */
export function History({ today, units }: { today: string; units: Units }) {
  const [sentinel, seen] = useInView<HTMLDivElement>()
  return (
    <div ref={sentinel}>
      {seen ? (
        <>
          <RecentStrip today={today} units={units} />
          <RecentWeeks today={today} />
        </>
      ) : null}
    </div>
  )
}
