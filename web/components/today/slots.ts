/**
 * The named places on Today where a later epic puts one line or card, and the height each may
 * take. This table is the contract between the page and the epics that fill it (E1-8, E4-6, E5-8
 * and E6): the page is built and measured to these numbers, and an epic builds its content to them.
 *
 * | slot         | content                                 | owner | budget |
 * | ------------ | --------------------------------------- | ----- | ------ |
 * | `disruption` | disruption banner or rest-window prompt | E5    | 64 px  |
 * | `fuel`       | fuel target line, beside the targets    | E6    | 26 px  |
 * | `watch`      | wrist line, under the session actions   | E1    | 24 px  |
 * | `brief`      | weekly brief line                       | E4    | 52 px  |
 * | `fuelPrompt` | fuel prompt card, below the fold        | E6    | none   |
 *
 * Where each sits, in DOM order: `disruption` at the top of the session group, over the readiness
 * read; `fuel` in the hero, under the targets; `watch` in the hero, under Done, Explain and Not
 * today; `brief` in the week group, under the week strip; `fuelPrompt` lower in the week group.
 *
 * **What a budget is.** The tallest the content may be, in CSS pixels, at a 360 px viewport (a
 * 328 px column), whatever state it shows. Content that could be taller stays inside its box
 * (`BriefLine` clamps its text to two lines inside one link); it never grows the box. The
 * budget is the height of the slot's own `<div data-slot data-budget-px>`; the space between a slot
 * and its neighbours belongs to the page, so content carries no margin of its own. The owning
 * epic's e2e asserts that its real content fits its budget at 360 px.
 *
 * **Why they are fixed.** The first screen is measured, not estimated (`tests/e2e/12-today.spec.ts`,
 * the fold tests): with every budget filled and the check-in unanswered, Done's bottom edge is at
 * most 788 px at 390 x 844 (the viewport above the 56 px tab bar); once the check-in is answered it
 * is at most 707 px at 390 x 707 (an installed app). The test fills each slot to exactly its
 * budget, so content that fits its budget cannot move Done below the fold. A budget raised here
 * is paid for in that test, so raising one is a change to the page, not to the epic.
 *
 * **How a slot is filled.** `TodaySlot` renders nothing while a slot has no content, so an empty
 * slot costs no height. A page places a slot without content and the epic that owns it registers a
 * mount for it in `slotMounts.tsx` (E6 does for `fuel` and `fuelPrompt`, E1 for `watch`, E4 for
 * `brief`, E5 for `disruption`), so filling a slot edits no page: `DashboardPage.tsx` and
 * `SessionHero.tsx` stay as they are. Every mount reads the Today payload (`coach.slots.<name>`), the
 * `brief` mount included, so the first screen keeps to its two requests. A slot whose data is missing
 * offline renders nothing.
 *
 * **Above and below the fold.** `disruption`, `fuel`, `watch` and `brief` are budgeted because they
 * sit on or near the first screen. `fuelPrompt` sits below the fold in the week group and has no
 * budget. On a screen wider than 900 px the page stands in two columns, the session group on the
 * left and the week group on the right; the budgets are the same, the columns are wider.
 */
export const SLOT_BUDGETS_PX = {
  disruption: 64,
  fuel: 26,
  watch: 24,
  brief: 52,
  fuelPrompt: null,
} as const satisfies Record<string, number | null>

export type SlotName = keyof typeof SLOT_BUDGETS_PX
