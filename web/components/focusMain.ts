/** True when nothing holds focus any more, as after the focused control unmounts. */
export function isFocusLost(): boolean {
  return document.activeElement === null || document.activeElement === document.body
}

/**
 * Sends focus to the main landmark, the one stable place on every page, without scrolling. For a
 * control that takes itself away (a sheet that closes, an offer that is put off) while it holds
 * focus: call it when `isFocusLost()`, so a keyboard user does not start again from the top.
 */
export function focusMain(): void {
  document.getElementById('main')?.focus({ preventScroll: true })
}
