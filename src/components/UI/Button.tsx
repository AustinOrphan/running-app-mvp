import React, { forwardRef, ButtonHTMLAttributes } from 'react';
import styles from '../../styles/components/Button.module.css';

/**
 * Button component props interface
 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  /** Visual style variant of the button */
  variant?: 'primary' | 'secondary' | 'danger' | 'warning' | 'success';

  /** Size variant of the button */
  size?: 'small' | 'medium' | 'large';

  /** Whether the button is in a loading state */
  loading?: boolean;

  /** Icon to display in the button */
  icon?: React.ReactNode;

  /** Position of the icon relative to text */
  iconPosition?: 'left' | 'right';

  /** Whether the button should take full width of its container */
  fullWidth?: boolean;

  /** Additional CSS classes to apply */
  className?: string;

  /** Children elements (usually text) */
  children?: React.ReactNode;
}

/**
 * Enhanced Button component with multiple variants and features
 *
 * @example
 * ```tsx
 * <Button variant="primary" size="medium" onClick={handleClick}>
 *   Click me
 * </Button>
 *
 * <Button variant="danger" icon={<TrashIcon />} loading>
 *   Delete
 * </Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'medium',
      loading = false,
      disabled = false,
      icon,
      iconPosition = 'left',
      fullWidth = false,
      className = '',
      children,
      type = 'button',
      onClick,
      ...props
    },
    ref
  ) => {
    // Determine button classes based on props
    const buttonClasses = [
      styles.btn,
      styles[`btn${variant.charAt(0).toUpperCase() + variant.slice(1)}`],
      size === 'small' && styles.btnSmall,
      size === 'large' && styles.btnLarge,
      loading && styles.btnLoading,
      fullWidth && styles.btnFullWidth,
      !children && icon && styles.btnIcon,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    // Handle click events when not disabled or loading
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!disabled && !loading && onClick) {
        onClick(e);
      }
    };

    // Render icon if provided
    const renderIcon = () => {
      if (!icon) return null;

      return (
        <span className={styles.iconWrapper} aria-hidden='true'>
          {icon}
        </span>
      );
    };

    // Determine if button should be disabled
    const isDisabled = disabled || loading;

    // Determine aria-label for accessibility
    const ariaLabel = props['aria-label'] || (typeof children === 'string' ? children : undefined);

    return (
      <button
        ref={ref}
        type={type}
        className={buttonClasses}
        disabled={isDisabled}
        onClick={handleClick}
        aria-label={ariaLabel}
        aria-busy={loading}
        aria-disabled={isDisabled}
        {...props}
      >
        {loading ? (
          <>
            <span className={styles.loadingSpinner} aria-hidden='true' />
            <span className='sr-only'>Loading...</span>
          </>
        ) : (
          <>
            {icon && iconPosition === 'left' && renderIcon()}
            {children && <span className={styles.btnText}>{children}</span>}
            {icon && iconPosition === 'right' && renderIcon()}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

/**
 * Button Group component for grouping related buttons
 */
export interface ButtonGroupProps {
  /** Direction of button arrangement */
  direction?: 'horizontal' | 'vertical';

  /** Alignment of buttons within the group */
  align?: 'start' | 'center' | 'end' | 'justified';

  /** Gap between buttons */
  gap?: 'small' | 'medium' | 'large';

  /** Additional CSS classes */
  className?: string;

  /** Child buttons */
  children: React.ReactNode;
}

/**
 * ButtonGroup component for organizing multiple buttons together
 *
 * @example
 * ```tsx
 * <ButtonGroup>
 *   <Button variant="secondary">Cancel</Button>
 *   <Button variant="primary">Save</Button>
 * </ButtonGroup>
 * ```
 */
export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  direction = 'horizontal',
  align = 'start',
  gap = 'medium',
  className = '',
  children,
}) => {
  const groupClasses = [
    styles.btnGroup,
    direction === 'vertical' && styles.vertical,
    align === 'justified' && styles.justified,
    styles[`gap${gap.charAt(0).toUpperCase() + gap.slice(1)}`],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={groupClasses} role='group'>
      {children}
    </div>
  );
};

/**
 * Icon Button component - a specialized button for icon-only actions
 */
export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'fullWidth'> {
  /** Accessible label for the icon button */
  'aria-label': string;

  /** Icon to display */
  icon: React.ReactNode;

  /** Tooltip text to display on hover */
  tooltip?: string;
}

/**
 * IconButton component for icon-only actions
 *
 * @example
 * ```tsx
 * <IconButton
 *   icon={<EditIcon />}
 *   aria-label="Edit item"
 *   tooltip="Edit"
 *   onClick={handleEdit}
 * />
 * ```
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, tooltip, size = 'medium', ...props }, ref) => {
    return <Button ref={ref} size={size} icon={icon} title={tooltip} {...props} />;
  }
);

IconButton.displayName = 'IconButton';
