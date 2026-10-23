import type { FuelLabView, Units } from '../../shared/types.ts'
import { useFuelLab } from '../api/fuel.ts'
import { useSettings } from '../api/settings.ts'
import { EahCard } from '../components/fuel/EahCard.tsx'
import { FuelHistory } from '../components/fuel/FuelHistory.tsx'
import { FuelPromptCard } from '../components/fuel/FuelPromptCard.tsx'
import { FuelSettingsForm } from '../components/fuel/FuelSettingsForm.tsx'
import { FuelTargetCard } from '../components/fuel/FuelTargetCard.tsx'
import { labText } from '../components/fuel/fuelText.ts'
import { GutBlockCard } from '../components/fuel/GutBlockCard.tsx'
import { ProductManager } from '../components/fuel/ProductManager.tsx'
import { TierLadder } from '../components/fuel/TierLadder.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import styles from './FuelLabPage.module.css'

/**
 * The sections in the order a phone shows them: the target, the runs waiting for a log, the ladder
 * and its history, then the products, the gut-training block, the settings, the safety card and
 * the general disclaimer. From 900 px the first four stand in the left column and the next four in
 * the right, so the DOM order is the reading order at every width.
 */
function LabBody({ lab, units }: { lab: FuelLabView; units: Units | undefined }) {
  return (
    <div className={styles.page}>
      <div className={styles.columns}>
        <div className={styles.column}>
          <FuelTargetCard next={lab.next} />
          {units === undefined ? null : <FuelPromptCard prompts={lab.prompts} units={units} />}
          <TierLadder ladder={lab.ladder} />
          <FuelHistory history={lab.history} />
        </div>
        <div className={styles.column}>
          <ProductManager products={lab.products} />
          <GutBlockCard block={lab.block} clinician={lab.disclaimers.gutCondition} />
          <FuelSettingsForm key={JSON.stringify(lab.settings)} settings={lab.settings} />
          <div className={styles.eah}>
            <EahCard card={lab.eah} headingLevel="h2" />
          </div>
        </div>
      </div>
      <p className={styles.disclaimer}>{lab.disclaimers.general}</p>
    </div>
  )
}

/**
 * The Fuel lab (`/fuel`, reached from More): the fuel target of the next long run, the tier ladder
 * the runner has climbed, what each logged run did to it, the product list, the gut-training block,
 * the switches and the safety card about drinking too much. Everything comes from one read of
 * `GET /api/fuel`, which replays the ladder, so nothing here works out a rate.
 */
export function FuelLabPage() {
  const lab = useFuelLab()
  const settings = useSettings()
  // The prompt lines carry a distance in the runner's units; wait for them rather than show the
  // wrong ones for a moment, and fall back to kilometres when the settings cannot be read.
  const units = settings.data?.units ?? (settings.isError ? 'km' : undefined)

  return (
    <>
      <PageHeader title={labText.title()} context={labText.context()} />
      {lab.isError ? (
        <p role="alert" className={styles.error}>
          {labText.loadError()}
        </p>
      ) : lab.data === undefined ? (
        <Skeleton lines={6} />
      ) : (
        <LabBody lab={lab.data} units={units} />
      )}
    </>
  )
}
