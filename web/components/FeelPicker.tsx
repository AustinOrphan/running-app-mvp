// Stub from the data-foundation scaffold; Task D15 builds the chips.
import type { Feel } from '../../shared/types.ts'

export interface FeelPickerProps {
  value: Feel | null
  onChange: (value: Feel | null) => void
}

export function FeelPicker({ value, onChange }: FeelPickerProps) {
  void value
  void onChange
  return null
}
