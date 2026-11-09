import { createDeviceSwitch } from '../deviceSwitch.ts'

/**
 * The Illustrations switch (visual design, section 5): a device setting like the theme, kept in
 * `localStorage` and off until the runner turns it on. A blocked or empty store reads as off.
 */
export const ILLUSTRATIONS_KEY = 'rl_illustrations'

/** Whether the drawings show, and the one way to change it. */
export const useIllustrations = createDeviceSwitch(ILLUSTRATIONS_KEY, false)
