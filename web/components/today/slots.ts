/**
 * The named places on Today where a later epic puts one line or card, and the height each may
 * take. A budget is the tallest the content may be, in CSS pixels, at a 360 px viewport; the
 * owning epic's e2e asserts that its real content fits. `fuelPrompt` sits below the fold and has
 * no budget.
 *
 * | slot         | content                                   | owner |
 * | ------------ | ----------------------------------------- | ----- |
 * | `disruption` | disruption banner or rest-window prompt   | E5    |
 * | `fuel`       | fuel target line, beside the targets      | E6    |
 * | `watch`      | wrist line, under the session actions     | E1    |
 * | `brief`      | change line, then the weekly brief line   | E4    |
 * | `fuelPrompt` | fuel prompt card                          | E6    |
 *
 * `TodaySlot` renders nothing while a slot has no content, so an empty slot costs no height.
 */
export const SLOT_BUDGETS_PX = {
  disruption: 64,
  fuel: 26,
  watch: 24,
  brief: 52,
  fuelPrompt: null,
} as const satisfies Record<string, number | null>

export type SlotName = keyof typeof SLOT_BUDGETS_PX
