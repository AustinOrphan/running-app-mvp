import { useEffect, useState } from 'react'
import { restPromptWords } from '../../../shared/copy/windowView.ts'
import type { TodayView, Units } from '../../../shared/types.ts'
import { DisruptionBanners } from '../disruption/DisruptionBanner.tsx'
import { RestWindowPrompt } from '../disruption/RestWindowPrompt.tsx'
import { focusMain, isFocusLost } from '../focusMain.ts'
import { NotFullSheet } from '../lazySheets.tsx'
import { SlotFrame } from './SlotFrame.tsx'

/**
 * E5: the `disruption` slot (64 px) at the top of the session group. It holds the window in effect
 * on the day (else the next one ahead) as the compact banner, or, with no window and a check-in
 * that reports illness or pain, the offer of one. Both come from the Today payload
 * (`coach.slots.disruption`), so the slot asks the server for nothing, and it takes no height
 * while the payload holds neither.
 *
 * The sheets stay out of the frame. A window that is removed leaves the payload and a window that
 * is made turns the offer into a banner, and each sheet has to stay open for its undo and its
 * "Done". So `DisruptionBanners` is always mounted, with an empty list when there is no window, and
 * the frame wraps only what they draw; the "Not 100%" sheet of the offer is kept here for the same
 * reason. "Not now" lasts until the page is left: it is not stored, so no health detail is written
 * to the device.
 *
 * The offer arrives after a check-in, above the readiness read, with nothing moving focus to it. A
 * polite status region that is always in the page says the question when the offer appears, which a
 * region that arrived with its content would not. It is a sibling of the slot, not its parent: the
 * page styles `[data-slot]` as a child of its column. "Not now" removes the button that holds focus,
 * so focus goes to the main landmark, as it does when a sheet closes over a control that is gone.
 */
export function DisruptionSlot({ view, units }: { view: TodayView; units: Units }) {
  const slot = view.coach.slots.disruption
  const window = slot?.window ?? null
  const [later, setLater] = useState(false)
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    if (later && isFocusLost()) focusMain()
  }, [later])

  const offered = slot?.offer === true && !later
  const prompt = offered ? (
    <RestWindowPrompt
      units={units}
      onSetUp={() => {
        setSheet(true)
      }}
      onLater={() => {
        setLater(true)
      }}
    />
  ) : null

  return (
    <>
      <DisruptionBanners
        windows={window === null ? [] : [window]}
        today={view.date}
        units={units}
        compact
        frame={(banners) => (
          <SlotFrame name="disruption">
            {banners}
            {prompt}
          </SlotFrame>
        )}
      />
      <div role="status" className="visually-hidden">
        {offered ? restPromptWords(units).ask : null}
      </div>
      {sheet ? (
        <NotFullSheet
          today={view.date}
          onClose={() => {
            setSheet(false)
          }}
        />
      ) : null}
    </>
  )
}
