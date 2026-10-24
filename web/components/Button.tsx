import { forwardRef, type ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  /** Disables the button while its action runs. */
  loading?: boolean
  /**
   * Marks the button busy and ignores clicks without disabling it. A focused control that becomes
   * disabled drops focus to the page, so a button the runner has just pressed uses this when its
   * action must not hand focus away, as when a dialog or a choice follows it.
   */
  busy?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    loading = false,
    busy = false,
    disabled,
    className,
    onClick,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(' ')
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled === true || loading}
      aria-disabled={busy ? true : undefined}
      aria-busy={loading || busy ? true : undefined}
      onClick={
        busy
          ? (event) => {
              // A busy submit button must not submit twice either.
              event.preventDefault()
            }
          : onClick
      }
    >
      {children}
    </button>
  )
})
