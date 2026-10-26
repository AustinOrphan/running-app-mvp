import {
  LOAD_POSITIONS,
  loadAgeRule,
  loadFieldLabel,
  loadHintLines,
  loadName,
  loadTradeoff,
} from '../../shared/copy/load.ts'
import type { LoadAppetite } from '../../shared/engine/types.ts'
import { Segmented } from './Segmented.tsx'

const LOAD_OPTIONS: Array<{ value: LoadAppetite; label: string }> = LOAD_POSITIONS.map(
  (position) => ({ value: position, label: loadName(position) }),
)

/**
 * The choice of a load position [rules g-8]: the three positions as a radio group, with the hint of
 * the one chosen, the age rule beside Upper band and the trade-off line. The one rendering of the
 * choice, for the Generate form and for the sheet that changes the setting of a plan, so that both
 * say the same thing.
 */
export function LoadField({
  value,
  onChange,
}: {
  value: LoadAppetite
  onChange: (value: LoadAppetite) => void
}) {
  return (
    <Segmented<LoadAppetite>
      label={loadFieldLabel()}
      hint={[
        ...loadHintLines(value),
        ...(value === 'upper' ? [loadAgeRule()] : []),
        loadTradeoff(),
      ]}
      options={LOAD_OPTIONS}
      value={value}
      onChange={onChange}
    />
  )
}
