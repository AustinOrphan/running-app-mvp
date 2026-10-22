// Stub from the data-foundation scaffold; Task D7 implements it.
import type { PullProvider } from './types.ts'

export const garminProvider: PullProvider = {
  connect() {
    throw new Error('not implemented')
  },
  listActivities() {
    throw new Error('not implemented')
  },
  fetchActivity() {
    throw new Error('not implemented')
  },
  listWellness() {
    throw new Error('not implemented')
  },
}
