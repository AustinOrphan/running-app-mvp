import React, { forwardRef, InputHTMLAttributes, useId, useState, useCallback } from 'react';
import styles from '../../styles/components/Form.module.css';

/**
 * Input component props interface
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  /** Input type */
  type?: 'text' | 'email' | 'password' | 'number' | 'date' | 'time' | 'tel' | 'url' | 'search' | 'color';
  
  /** Label text for the input */
  label?: string;
  
  /** Helper text displayed below the input */
  helperText?: string;
  
  /** Whether the input has an error */
  error?: boolean;
  
  /** Error message to display */
  errorMessage?: string;
  
  /** Whether the input has a success state */
  success?: boolean;
  
  /** Success message to display */
  successMessage?: string;
  
  /** Size variant of the input */
  size?: 'small' | 'medium' | 'large';
  
  /** Whether the input should take full width */
  fullWidth?: boolean;
  
  /** Icon to display at the start of the input */
  leadingIcon?: React.ReactNode;
  
  /** Icon to display at the end of the input */
  trailingIcon?: React.ReactNode;
  
  /** Click handler for trailing icon */
  onTrailingIconClick?: () => void;
  
  /** Whether to show character count */
  showCharCount?: boolean;
  
  /** Additional CSS classes */
  className?: string;
}

/**
 * Input component with validation states and accessibility features
 * 
 * @example
 * ```tsx
 * <Input
 *   type="email"
 *   label="Email Address"
 *   required
 *   error={errors.email}
 *   errorMessage="Please enter a valid email"
 * />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      type = 'text',
      label,
      helperText,
      error = false,
      errorMessage,
      success = false,
      successMessage,
      size = 'medium',
      fullWidth = true,
      leadingIcon,
      trailingIcon,
      onTrailingIconClick,
      showCharCount = false,
      className = '',
      required = false,
      disabled = false,
      readOnly = false,
      value,
      maxLength,
      id,
      ...props
    },
    ref
  ) => {
    // Generate unique ID if not provided
    const generatedId = useId();
    const inputId = id || generatedId;
    
    // State for password visibility toggle
    const [showPassword, setShowPassword] = useState(false);
    
    // Determine the actual input type (handle password visibility)
    const actualType = type === 'password' && showPassword ? 'text' : type;
    
    // Handle password toggle
    const handlePasswordToggle = useCallback(() => {
      setShowPassword(prev => !prev);
    }, []);
    
    // Handle search clear
    const handleSearchClear = useCallback(() => {
      if (props.onChange) {
        const event = {
          target: { value: '' }
        } as React.ChangeEvent<HTMLInputElement>;
        props.onChange(event);
      }
    }, [props]);
    
    // Determine trailing icon based on input type
    const getTrailingIcon = () => {
      if (type === 'password' && !trailingIcon) {
        return (
          <span aria-label={showPassword ? 'Hide password' : 'Show password'}>
            {showPassword ? '👁️‍🗨️' : '👁️'}
          </span>
        );
      }
      if (type === 'search' && value && !trailingIcon) {
        return (
          <span aria-label="Clear search">✕</span>
        );
      }
      return trailingIcon;
    };
    
    // Determine trailing icon click handler
    const getTrailingIconClick = () => {
      if (type === 'password' && !onTrailingIconClick) {
        return handlePasswordToggle;
      }
      if (type === 'search' && value && !onTrailingIconClick) {
        return handleSearchClear;
      }
      return onTrailingIconClick;
    };
    
    const effectiveTrailingIcon = getTrailingIcon();
    const effectiveTrailingIconClick = getTrailingIconClick();
    
    // Determine input classes
    const inputClasses = [
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
    
    // Calculate character count
    const charCount = typeof value === 'string' ? value.length : 0;
    
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
      <div className={inputClasses}>
        {label && (
          <label htmlFor={inputId} className={required ? styles.required : ''}>
            {label}
          </label>
        )}
        
        <div className={styles.inputWrapper}>
          {leadingIcon && (
            <span className={styles.leadingIcon} aria-hidden="true">
              {leadingIcon}
            </span>
          )}
          
          <input
            ref={ref}
            id={inputId}
            type={actualType}
            className={fieldClasses}
            disabled={disabled}
            readOnly={readOnly}
            required={required}
            aria-invalid={error}
            aria-describedby={message ? `${inputId}-message` : undefined}
            aria-required={required}
            value={value}
            maxLength={maxLength}
            {...props}
          />
          
          {effectiveTrailingIcon && (
            <button
              type="button"
              className={styles.trailingIcon}
              onClick={effectiveTrailingIconClick}
              disabled={disabled}
              tabIndex={effectiveTrailingIconClick ? 0 : -1}
              aria-hidden={!effectiveTrailingIconClick}
            >
              {effectiveTrailingIcon}
            </button>
          )}
        </div>
        
        {(message || (showCharCount && maxLength)) && (
          <div className={styles.inputFooter}>
            {message && (
              <span id={`${inputId}-message`} className={messageClass}>
                {message}
              </span>
            )}
            
            {showCharCount && maxLength && (
              <span className={styles.charCount}>
                {charCount}/{maxLength}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

/**
 * Props for InputGroup component
 */
export interface InputGroupProps {
  /** Label for the group */
  label?: string;
  
  /** Helper text for the group */
  helperText?: string;
  
  /** Whether fields are arranged horizontally */
  horizontal?: boolean;
  
  /** Additional CSS classes */
  className?: string;
  
  /** Child inputs */
  children: React.ReactNode;
}

/**
 * InputGroup component for organizing related inputs
 * 
 * @example
 * ```tsx
 * <InputGroup label="Personal Information" horizontal>
 *   <Input label="First Name" />
 *   <Input label="Last Name" />
 * </InputGroup>
 * ```
 */
export const InputGroup: React.FC<InputGroupProps> = ({
  label,
  helperText,
  horizontal = false,
  className = '',
  children
}) => {
  const groupClasses = [
    styles.formSection,
    horizontal ? styles.formRow : styles.formColumn,
    className
  ]
    .filter(Boolean)
    .join(' ');
  
  return (
    <fieldset className={groupClasses}>
      {label && <legend className={styles.groupLabel}>{label}</legend>}
      
      <div className={horizontal ? styles.formRowAutoFit : styles.formColumn}>
        {children}
      </div>
      
      {helperText && (
        <p className={styles.fieldDescription}>{helperText}</p>
      )}
    </fieldset>
  );
};

/**
 * Props for TextArea component
 */
export interface TextAreaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  /** Label text */
  label?: string;
  
  /** Helper text */
  helperText?: string;
  
  /** Error state */
  error?: boolean;
  
  /** Error message */
  errorMessage?: string;
  
  /** Success state */
  success?: boolean;
  
  /** Success message */
  successMessage?: string;
  
  /** Size variant */
  size?: 'small' | 'medium' | 'large';
  
  /** Full width */
  fullWidth?: boolean;
  
  /** Show character count */
  showCharCount?: boolean;
  
  /** Resize behavior */
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  
  /** Auto-resize to fit content */
  autoResize?: boolean;
  
  /** Maximum height for auto-resize (in pixels) */
  maxAutoHeight?: number;
}

/**
 * TextArea component for multi-line text input
 * 
 * @example
 * ```tsx
 * <TextArea
 *   label="Description"
 *   rows={4}
 *   maxLength={500}
 *   showCharCount
 * />
 * ```
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
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
      showCharCount = false,
      resize = 'vertical',
      autoResize = false,
      maxAutoHeight = 400,
      className = '',
      required = false,
      disabled = false,
      readOnly = false,
      value,
      maxLength,
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const textareaId = id || generatedId;
    const [textareaRef, setTextareaRef] = useState<HTMLTextAreaElement | null>(null);
    
    // Combine refs
    const combinedRef = useCallback(
      (node: HTMLTextAreaElement | null) => {
        setTextareaRef(node);
        if (ref) {
          if (typeof ref === 'function') {
            ref(node);
          } else {
            ref.current = node;
          }
        }
      },
      [ref]
    );
    
    // Auto-resize functionality
    const adjustHeight = useCallback(() => {
      if (textareaRef && autoResize) {
        // Reset height to auto to get the correct scrollHeight
        textareaRef.style.height = 'auto';
        const newHeight = Math.min(textareaRef.scrollHeight, maxAutoHeight);
        textareaRef.style.height = `${newHeight}px`;
      }
    }, [autoResize, maxAutoHeight]);
    
    // Adjust height on value change
    React.useEffect(() => {
      adjustHeight();
    }, [value, adjustHeight]);
    
    // Handle input for auto-resize
    const handleInput = useCallback(
      (e: React.FormEvent<HTMLTextAreaElement>) => {
        adjustHeight();
        if (props.onInput) {
          props.onInput(e);
        }
      },
      [adjustHeight, props]
    );
    
    const textareaClasses = [
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
      size === 'large' && styles.large,
      autoResize ? styles.autoResize : styles[`resize${resize.charAt(0).toUpperCase() + resize.slice(1)}`]
    ]
      .filter(Boolean)
      .join(' ');
    
    const charCount = typeof value === 'string' ? value.length : 0;
    
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
      <div className={textareaClasses}>
        {label && (
          <label htmlFor={textareaId} className={required ? styles.required : ''}>
            {label}
          </label>
        )}
        
        <textarea
          ref={combinedRef}
          id={textareaId}
          className={fieldClasses}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          aria-invalid={error}
          aria-describedby={message ? `${textareaId}-message` : undefined}
          aria-required={required}
          value={value}
          maxLength={maxLength}
          onInput={handleInput}
          style={autoResize ? { overflow: 'hidden', resize: 'none' } : undefined}
          {...props}
        />
        
        {(message || (showCharCount && maxLength)) && (
          <div className={styles.inputFooter}>
            {message && (
              <span id={`${textareaId}-message`} className={messageClass}>
                {message}
              </span>
            )}
            
            {showCharCount && maxLength && (
              <span className={styles.charCount}>
                {charCount}/{maxLength}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
);

TextArea.displayName = 'TextArea';

