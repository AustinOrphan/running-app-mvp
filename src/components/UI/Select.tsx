import React, { forwardRef, SelectHTMLAttributes, useId } from 'react';
import styles from '../../styles/components/Form.module.css';

/**
 * Select component props interface
 */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Label text for the select */
  label?: string;
  
  /** Helper text displayed below the select */
  helperText?: string;
  
  /** Whether the select has an error */
  error?: boolean;
  
  /** Error message to display */
  errorMessage?: string;
  
  /** Whether the select has a success state */
  success?: boolean;
  
  /** Success message to display */
  successMessage?: string;
  
  /** Size variant of the select */
  size?: 'small' | 'medium' | 'large';
  
  /** Whether the select should take full width */
  fullWidth?: boolean;
  
  /** Additional CSS classes */
  className?: string;
  
  /** Options for the select */
  options?: Array<{
    value: string;
    label: string;
    disabled?: boolean;
  }>;
  
  /** Placeholder option */
  placeholder?: string;
}

/**
 * Select component with validation states and accessibility features
 * 
 * @example
 * ```tsx
 * <Select
 *   label="Goal Type"
 *   required
 *   options={[
 *     { value: 'distance', label: 'Distance Goal' },
 *     { value: 'time', label: 'Time Goal' },
 *     { value: 'frequency', label: 'Frequency Goal' }
 *   ]}
 *   error={errors.type}
 *   errorMessage="Please select a goal type"
 * />
 * ```
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      helperText,
      error = false,
      errorMessage,
      success = false,
      successMessage,
      size = 'medium',
      fullWidth = true,
      className = '',
      required = false,
      disabled = false,
      options = [],
      placeholder,
      children,
      id,
      ...props
    },
    ref
  ) => {
    // Generate unique ID if not provided
    const generatedId = useId();
    const selectId = id || generatedId;
    
    // Determine select classes
    const selectClasses = [
      styles.formGroup,
      fullWidth && styles.fullWidth,
      className
    ]
      .filter(Boolean)
      .join(' ');
    
    const fieldClasses = [
      error && styles.error,
      success && styles.success,
      size === 'small' && styles.small,
      size === 'large' && styles.large
    ]
      .filter(Boolean)
      .join(' ');
    
    // Determine which message to show
    const message = error && errorMessage 
      ? errorMessage 
      : success && successMessage 
      ? successMessage 
      : helperText;
    
    const messageClass = error 
      ? styles.errorMessage 
      : success 
      ? styles.successMessage 
      : styles.fieldDescription;
    
    return (
      <div className={selectClasses}>
        {label && (
          <label htmlFor={selectId} className={required ? styles.required : ''}>
            {label}
          </label>
        )}
        
        <select
          ref={ref}
          id={selectId}
          className={fieldClasses}
          disabled={disabled}
          required={required}
          aria-invalid={error}
          aria-describedby={message ? `${selectId}-message` : undefined}
          aria-required={required}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          
          {/* Render options if provided */}
          {options.length > 0 && options.map(option => (
            <option 
              key={option.value} 
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
          
          {/* Allow children for custom option rendering */}
          {children}
        </select>
        
        {message && (
          <span id={`${selectId}-message`} className={messageClass}>
            {message}
          </span>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';

/**
 * Option group component for organizing select options
 */
export interface OptionGroupProps {
  label: string;
  children: React.ReactNode;
}

export const OptionGroup: React.FC<OptionGroupProps> = ({ label, children }) => {
  return <optgroup label={label}>{children}</optgroup>;
};

