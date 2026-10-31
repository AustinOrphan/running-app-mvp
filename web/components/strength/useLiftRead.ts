import { useEffect, useRef, useState } from 'react'
import type { WorkoutLift } from '../../../shared/types.ts'
import { useStrengthWorkoutFor, type DayRead } from '../../api/strength.ts'

/** Where a read of one lift stands, for the control that asked for it. */
export interface LiftRead {
  /** The exercise being read or just refused, null when none was asked for. */
  chosen: string | null
  /** The server has not answered yet. */
  reading: boolean
  /** The read failed (no connection, or the server refused). */
  failed: boolean
  /** The server answered that the saved equipment cannot make the exercise. */
  unavailable: boolean
  /** Asks for an exercise as a lift of the session. */
  choose: (exerciseId: string) => void
  /** Asks again after a failure. */
  retry: () => void
}

/**
 * The read behind "Swap" and "Add a lift" (design 7.3, 9.1): the rules, not the sheet, give a lift
 * its sets and its load, so a choice is sent to `GET /api/strength/workout` with `swap` and the
 * lift that comes back is handed to `onLift`. `read` is null where the sheet cannot ask (a saved log
 * being edited), and then nothing is sent.
 *
 * It lives in the panel that lists the choices, which the control closes once a lift is in place,
 * so a choice never outlives its answer: there is no state to reset.
 */
export function useLiftRead(read: DayRead | null, onLift: (lift: WorkoutLift) => void): LiftRead {
  const [chosen, setChosen] = useState<string | null>(null)
  const query = useStrengthWorkoutFor({
    date: read?.date ?? '',
    ...(read?.sessionId === undefined ? {} : { sessionId: read.sessionId }),
    swap: chosen ?? undefined,
    enabled: read !== null && chosen !== null,
  })
  // the callback is the latest of the render that got the answer, not the one that asked
  const apply = useRef(onLift)
  useEffect(() => {
    apply.current = onLift
  })

  const lift = chosen === null ? null : (query.data?.lift ?? null)
  useEffect(() => {
    if (lift !== null) apply.current(lift)
  }, [lift])

  return {
    chosen,
    reading: chosen !== null && read !== null && query.isFetching,
    failed: chosen !== null && query.isError && !query.isFetching,
    unavailable: chosen !== null && query.isSuccess && query.data.lift === null,
    choose: setChosen,
    retry: () => {
      void query.refetch()
    },
  }
}
