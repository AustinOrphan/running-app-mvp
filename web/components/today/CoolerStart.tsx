import { formatAirTemperature } from '../../../shared/copy/quantity.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { TodayHeat, Units } from '../../../shared/types.ts'
import styles from './CoolerStart.module.css'

/** Hour of day, 0-23, as the clock reads it. */
const hourText = (hour: number): string => `${String(hour).padStart(2, '0')}:00`

/**
 * "Cooler start: 06:00. WBGT about 17 °C then, 25 °C around 15:00." Shown only when the server
 * found a start hour that is cooler by enough to matter. The peak figure is known for a WBGT
 * reading only, so an air-temperature day names the cooler hour and the temperature then. A WBGT
 * reads in °C in either unit system; an air temperature follows the units (°F with miles).
 */
export function CoolerStart({ heat, units }: { heat: TodayHeat; units: Units }) {
  if (heat.coolerHour === null || heat.coolerValue === null) return null
  const thenC = Math.round(heat.coolerValue)
  const text =
    heat.index === 'wbgt' && heat.wbgtC !== null && heat.peakHour !== null
      ? render(
          TEMPLATES['today.cooler.wbgt'],
          {
            time: heat.coolerHour,
            then: { kind: 'temp', c: thenC },
            peak: { kind: 'temp', c: Math.round(heat.wbgtC) },
            hour: hourText(heat.peakHour),
          },
          units,
        )
      : render(
          TEMPLATES['today.cooler.air'],
          { time: heat.coolerHour, then: formatAirTemperature(thenC, units) },
          units,
        )
  return <p className={styles.cooler}>{text}</p>
}
