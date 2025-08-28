import React, { useState, useRef } from 'react';

interface EnhancedButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  ripple?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

export const EnhancedButton: React.FC<EnhancedButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  ripple = true,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  className = '',
  onClick,
  disabled,
  ...props
}) => {
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rippleIdRef = useRef(0);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || loading) return;

    if (ripple && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = ++rippleIdRef.current;

      setRipples(prev => [...prev, { x, y, id }]);

      // Remove ripple after animation
      setTimeout(() => {
        setRipples(prev => prev.filter(r => r.id !== id));
      }, 600);
    }

    onClick?.(e);
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          background: 'var(--color-primary)',
          color: 'var(--color-text-inverse)',
          border: '1px solid var(--color-primary)',
        };
      case 'secondary':
        return {
          background: 'var(--color-secondary)',
          color: 'var(--color-text-inverse)',
          border: '1px solid var(--color-secondary)',
        };
      case 'success':
        return {
          background: 'var(--color-success)',
          color: 'var(--color-text-inverse)',
          border: '1px solid var(--color-success)',
        };
      case 'warning':
        return {
          background: 'var(--color-warning)',
          color: 'var(--color-text-inverse)',
          border: '1px solid var(--color-warning)',
        };
      case 'error':
        return {
          background: 'var(--color-error)',
          color: 'var(--color-text-inverse)',
          border: '1px solid var(--color-error)',
        };
      default:
        return {
          background: 'var(--color-primary)',
          color: 'var(--color-text-inverse)',
          border: '1px solid var(--color-primary)',
        };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          padding: '0.5rem 0.75rem',
          fontSize: 'var(--font-size-sm)',
          minHeight: '2rem',
        };
      case 'lg':
        return {
          padding: '0.75rem 1.5rem',
          fontSize: 'var(--font-size-lg)',
          minHeight: '3rem',
        };
      default:
        return {
          padding: '0.625rem 1rem',
          fontSize: 'var(--font-size-base)',
          minHeight: '2.5rem',
        };
    }
  };

  const variantStyles = getVariantStyles();
  const sizeStyles = getSizeStyles();

  return (
    <button
      ref={buttonRef}
      className={`enhanced-button btn-enhanced ${className}`}
      style={{
        ...variantStyles,
        ...sizeStyles,
        width: fullWidth ? '100%' : 'auto',
        opacity: disabled || loading ? 0.6 : 1,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
      }}
      onClick={handleClick}
      disabled={disabled || loading}
      {...props}
    >
      <div className='button-content'>
        {loading && (
          <div className='loading-spinner'>
            <div className='spinner'></div>
          </div>
        )}

        {!loading && icon && iconPosition === 'left' && (
          <span className='button-icon icon-left'>{icon}</span>
        )}

        <span className='button-text' style={{ opacity: loading ? 0 : 1 }}>
          {children}
        </span>

        {!loading && icon && iconPosition === 'right' && (
          <span className='button-icon icon-right'>{icon}</span>
        )}
      </div>

      {/* Ripple effects */}
      {ripples.map(ripple => (
        <span
          key={ripple.id}
          className='ripple'
          style={{
            left: ripple.x,
            top: ripple.y,
          }}
        />
      ))}

      <style>{`
        .enhanced-button {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--border-radius);
          font-weight: var(--font-weight-medium);
          text-decoration: none;
          transition: all var(--transition-normal);
          overflow: hidden;
          user-select: none;
          transform: translateZ(0);
        }

        .enhanced-button:focus {
          outline: none;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
        }

        .button-content {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          position: relative;
          z-index: 2;
        }

        .button-icon {
          display: flex;
          align-items: center;
          font-size: 1.1em;
        }

        .button-text {
          transition: opacity var(--transition-fast);
        }

        .loading-spinner {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
        }

        .spinner {
          width: 1.25rem;
          height: 1.25rem;
          border: 2px solid transparent;
          border-top-color: currentColor;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .ripple {
          position: absolute;
          width: 0;
          height: 0;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.6);
          transform: translate(-50%, -50%);
          animation: rippleEffect 0.6s ease-out;
          pointer-events: none;
        }

        @keyframes rippleEffect {
          to {
            width: 200px;
            height: 200px;
            opacity: 0;
          }
        }

        /* Size-specific icon adjustments */
        .enhanced-button.size-sm .button-icon {
          font-size: 1em;
        }

        .enhanced-button.size-lg .button-icon {
          font-size: 1.2em;
        }

        /* Reduce motion support */
        @media (prefers-reduced-motion: reduce) {
          .enhanced-button {
            transition: none;
          }
          
          .ripple {
            animation: none;
          }
          
          .spinner {
            animation: none;
          }
        }
      `}</style>
    </button>
  );
};
