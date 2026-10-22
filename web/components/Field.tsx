import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import styles from './Field.module.css'

export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export interface FieldProps {
  label: string
  hint?: string
  error?: string
  children: (a: FieldControlProps) => ReactNode
}

/** A label, a control and one line of help; an error replaces the hint. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const message = error ?? hint
  const control: FieldControlProps = { id }
  if (message !== undefined && message !== '') control['aria-describedby'] = messageId
  if (error !== undefined && error !== '') control['aria-invalid'] = true

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children(control)}
      {message !== undefined && message !== '' ? (
        <p
          id={messageId}
          className={error !== undefined && error !== '' ? styles.error : styles.hint}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}

function join(...names: Array<string | undefined>): string {
  return names.filter(Boolean).join(' ')
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input {...rest} ref={ref} className={join(styles.control, className)} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...rest }, ref) {
    return <select {...rest} ref={ref} className={join(styles.control, styles.select, className)} />
  },
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={rows}
      className={join(styles.control, styles.textarea, className)}
    />
  )
})
