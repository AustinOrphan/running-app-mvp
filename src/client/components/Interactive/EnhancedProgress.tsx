import React, { useEffect, useState } from 'react';

interface EnhancedProgressProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'success' | 'warning' | 'error' | 'gradient';
  showValue?: boolean;
  animated?: boolean;
  striped?: boolean;
  className?: string;
  label?: string;
  pulse?: boolean;
  glow?: boolean;
}

export const EnhancedProgress: React.FC<EnhancedProgressProps> = ({
  value,
  max = 100,
  size = 'md',
  variant = 'default',
  showValue = false,
  animated = true,
  striped = false,
  className = '',
  label,
  pulse = false,
  glow = false,
}) => {
  const [animatedValue, setAnimatedValue] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  useEffect(() => {
    // Trigger entrance animation
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!animated) {
      setAnimatedValue(percentage);
      return;
    }

    // Smooth progress animation
    const duration = 1000; // 1 second
    const steps = 60; // 60fps
    const stepValue = percentage / steps;
    const stepInterval = duration / steps;

    let currentStep = 0;
    const timer = setInterval(() => {
      currentStep++;
      setAnimatedValue(() => {
        const newValue = stepValue * currentStep;
        return newValue >= percentage ? percentage : newValue;
      });

      if (currentStep >= steps) {
        clearInterval(timer);
      }
    }, stepInterval);

    return () => clearInterval(timer);
  }, [percentage, animated]);

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return { height: '0.5rem', fontSize: '0.75rem' };
      case 'lg':
        return { height: '1.5rem', fontSize: '1rem' };
      default:
        return { height: '1rem', fontSize: '0.875rem' };
    }
  };

  const getVariantColor = () => {
    switch (variant) {
      case 'success':
        return 'var(--color-success)';
      case 'warning':
        return 'var(--color-warning)';
      case 'error':
        return 'var(--color-error)';
      case 'gradient':
        return 'linear-gradient(90deg, var(--color-primary), var(--color-secondary))';
      default:
        return 'var(--color-primary)';
    }
  };

  const sizeStyles = getSizeStyles();
  const progressColor = getVariantColor();

  return (
    <div className={`enhanced-progress ${className}`}>
      {label && (
        <div className='progress-header'>
          <span className='progress-label'>{label}</span>
          {showValue && <span className='progress-value'>{Math.round(animatedValue)}%</span>}
        </div>
      )}

      <div
        className={`progress-container ${isVisible ? 'visible' : ''}`}
        style={{
          height: sizeStyles.height,
          background: 'var(--color-background-subtle)',
          borderRadius: 'var(--border-radius-full)',
          overflow: 'hidden',
          position: 'relative',
        }}
        role='progressbar'
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label || `Progress: ${Math.round(percentage)}%`}
      >
        {/* Main progress bar */}
        <div
          className={`progress-bar ${striped ? 'striped' : ''} ${pulse ? 'pulse' : ''}`}
          style={{
            width: `${animatedValue}%`,
            height: '100%',
            background: progressColor,
            borderRadius: 'inherit',
            transition: animated ? 'width 0.3s ease-out' : 'none',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Striped pattern */}
          {striped && <div className='stripe-pattern' />}

          {/* Glow effect */}
          {glow && animatedValue > 0 && <div className='glow-trail' />}

          {/* Progress shine effect */}
          {animated && animatedValue > 0 && <div className='progress-shine' />}
        </div>

        {/* Value display inside bar */}
        {showValue && !label && animatedValue > 20 && (
          <div className='inline-value'>{Math.round(animatedValue)}%</div>
        )}
      </div>

      <style>{`
        .enhanced-progress {
          width: 100%;
        }

        .progress-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .progress-label {
          font-size: ${sizeStyles.fontSize};
          font-weight: var(--font-weight-medium);
          color: var(--color-text-primary);
        }

        .progress-value {
          font-size: ${sizeStyles.fontSize};
          font-weight: var(--font-weight-semibold);
          color: var(--color-text-secondary);
          transition: all var(--transition-fast);
        }

        .progress-container {
          opacity: 0;
          transform: scaleX(0);
          transform-origin: left;
          transition: all 0.5s ease-out;
        }

        .progress-container.visible {
          opacity: 1;
          transform: scaleX(1);
        }

        .progress-bar {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .stripe-pattern {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: linear-gradient(
            45deg,
            rgba(255, 255, 255, 0.15) 25%,
            transparent 25%,
            transparent 50%,
            rgba(255, 255, 255, 0.15) 50%,
            rgba(255, 255, 255, 0.15) 75%,
            transparent 75%,
            transparent
          );
          background-size: 1rem 1rem;
          animation: stripeMove 1s linear infinite;
        }

        @keyframes stripeMove {
          0% { background-position-x: 0; }
          100% { background-position-x: 1rem; }
        }

        .pulse {
          animation: progressPulse 2s ease-in-out infinite;
        }

        @keyframes progressPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        .glow-trail {
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          background: inherit;
          border-radius: inherit;
          filter: blur(4px);
          opacity: 0.6;
          z-index: -1;
        }

        .progress-shine {
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.4),
            transparent
          );
          animation: progressShine 2s ease-in-out infinite;
        }

        @keyframes progressShine {
          0% { left: -100%; }
          100% { left: 100%; }
        }

        .inline-value {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: white;
          font-size: ${sizeStyles.fontSize};
          font-weight: var(--font-weight-semibold);
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
          mix-blend-mode: difference;
        }

        /* Accessibility improvements */
        @media (prefers-reduced-motion: reduce) {
          .progress-container,
          .progress-bar,
          .stripe-pattern,
          .progress-shine {
            animation: none;
            transition: none;
          }
          
          .progress-container {
            opacity: 1;
            transform: none;
          }
        }

        /* High contrast mode support */
        @media (prefers-contrast: high) {
          .progress-container {
            border: 1px solid var(--color-text-primary);
          }
          
          .progress-bar {
            background: var(--color-text-primary) !important;
          }
        }
      `}</style>
    </div>
  );
};
