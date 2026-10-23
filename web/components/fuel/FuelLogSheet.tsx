import { useActivityDetail } from '../../api/activities.ts'
import { useFuelLab, useFuelLog } from '../../api/fuel.ts'
import { Sheet } from '../Sheet.tsx'
import { Skeleton } from '../Skeleton.tsx'
import { FuelLogForm } from './FuelLogForm.tsx'
import { fuelText } from './fuelText.ts'
import styles from './FuelLogSheet.module.css'

export interface FuelLogSheetProps {
  activityId: string
  onClose: () => void
  /** The log was saved, or the run was marked "not this time". The caller closes the sheet. */
  onDone: () => void
}

/**
 * The fuel log of one run in a sheet: it reads the Fuel lab view (products, the latest logs, the
 * ladder), the run's current log and the run itself (elapsed time and weather), and shows the form
 * once all three are here. Mount it only while it is open.
 */
export function FuelLogSheet({ activityId, onClose, onDone }: FuelLogSheetProps) {
  const lab = useFuelLab()
  const log = useFuelLog(activityId)
  const detail = useActivityDetail(activityId)

  return (
    <Sheet open onClose={onClose} title={fuelText.logHeading()}>
      {lab.isError || log.isError || detail.isError ? (
        <p role="alert" className={styles.error}>
          {fuelText.loadError()}
        </p>
      ) : lab.data === undefined || log.data === undefined || detail.data === undefined ? (
        <Skeleton lines={4} />
      ) : (
        <FuelLogForm
          activityId={activityId}
          elapsedSec={detail.data.activity.durationSec}
          weather={{
            tempC: detail.data.activity.tempC,
            humidityPct: detail.data.activity.humidityPct,
            windKph: detail.data.activity.windKph,
          }}
          lab={lab.data}
          log={log.data}
          onDone={onDone}
        />
      )}
    </Sheet>
  )
}
