import {
  DATA_IN_USE_ERROR,
  DATA_IN_USE_LOADING,
  dataInUseText,
} from '../../shared/copy/dataInUse.ts'
import { useAthleteState } from '../api/state.ts'
import styles from './DataInUse.module.css'

/**
 * What the training advice reads: how many activities and wellness days, and how recent. The
 * numbers are the server's own count of the data the engine uses, so a flagged duplicate that the
 * advice leaves out is named, not hidden. A refresh that fails keeps the sentence already shown.
 */
export function DataInUse() {
  const state = useAthleteState()
  const text = state.data
    ? dataInUseText(state.data.inputs)
    : state.isError
      ? DATA_IN_USE_ERROR
      : DATA_IN_USE_LOADING
  return (
    <p role="status" className={styles.text}>
      {text}
    </p>
  )
}
