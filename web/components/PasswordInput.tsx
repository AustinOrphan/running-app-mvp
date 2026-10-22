import { Input, type FieldControlProps } from './Field.tsx'
import styles from './PasswordInput.module.css'

/** A password input with a show/hide toggle; `toggleLabel` completes "Show ..." and "Hide ...". */
export function PasswordInput({
  control,
  visible,
  onToggle,
  toggleLabel,
  value,
  onChange,
  autoComplete,
}: {
  control: FieldControlProps
  visible: boolean
  onToggle: () => void
  toggleLabel: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
}) {
  return (
    <div className={styles.passwordWrap}>
      <Input
        {...control}
        type={visible ? 'text' : 'password'}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={styles.passwordInput}
      />
      <button type="button" className={styles.toggle} onClick={onToggle}>
        {visible ? `Hide ${toggleLabel}` : `Show ${toggleLabel}`}
      </button>
    </div>
  )
}
