import { createDeviceSwitch } from './deviceSwitch.ts'

/**
 * The Condensed figures switch (an experiment, visual design section 9): a device setting like the
 * theme and the Map tiles switch, kept in `localStorage` and off until the runner turns it on.
 * On, the large figures (the `figure-type` class, see `global.css`) are set in Archivo at 75% width.
 */
export const CONDENSED_FIGURES_KEY = 'rl_condensed_figures'

/** The attribute on the root element that `global.css` reads. */
export const CONDENSED_FIGURES_ATTRIBUTE = 'data-condensed-figures'

/** Whether the figures are condensed, and the one way to change it. */
export const useCondensedFigures = createDeviceSwitch(CONDENSED_FIGURES_KEY, false)

let fontRequested = false

/**
 * Sets or clears the root attribute. The font's stylesheet (one latin `@font-face`, `figureFont.css`)
 * is imported the first time the switch is on, so a device that never turns it on requests neither
 * the stylesheet chunk nor the font file: nothing in the entry refers to either.
 */
export function applyCondensedFigures(on: boolean): void {
  const root = document.documentElement
  if (on) {
    root.setAttribute(CONDENSED_FIGURES_ATTRIBUTE, 'on')
    if (!fontRequested) {
      fontRequested = true
      import('../styles/figureFont.css').catch(() => {
        // the chunk could not be fetched (offline, not kept): the serif stands in until a reload
        fontRequested = false
      })
    }
  } else {
    root.removeAttribute(CONDENSED_FIGURES_ATTRIBUTE)
  }
}
