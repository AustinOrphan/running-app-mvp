import React, { useState, useRef } from 'react';

interface InteractiveCardProps {
  children: React.ReactNode;
  onClick?: () => void;
  onHover?: (isHovered: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
  elevation?: 1 | 2 | 3 | 4;
  interactive?: boolean;
  loading?: boolean;
  disabled?: boolean;
  glow?: boolean;
  tilt?: boolean;
}

export const InteractiveCard: React.FC<InteractiveCardProps> = ({
  children,
  onClick,
  onHover,
  className = '',
  style,
  elevation = 2,
  interactive = true,
  loading = false,
  disabled = false,
  glow = false,
  tilt = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (disabled || loading) return;
    setIsHovered(true);
    onHover?.(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setMousePosition({ x: 0, y: 0 });
    onHover?.(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!tilt || disabled || loading || !cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    setMousePosition({
      x: (x - centerX) / centerX,
      y: (y - centerY) / centerY,
    });
  };

  const handleClick = () => {
    if (disabled || loading) return;
    onClick?.();
  };

  const getShadow = () => {
    const shadows = {
      1: 'var(--shadow-sm)',
      2: 'var(--shadow-md)',
      3: 'var(--shadow-lg)',
      4: 'var(--shadow-xl)',
    };
    return shadows[elevation];
  };

  const getHoverShadow = () => {
    const hoverShadows = {
      1: 'var(--shadow-md)',
      2: 'var(--shadow-lg)',
      3: 'var(--shadow-xl)',
      4: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    };
    return hoverShadows[elevation];
  };

  const getTiltTransform = () => {
    if (!tilt || !isHovered) return 'none';

    const tiltX = mousePosition.y * 10; // Reduced intensity
    const tiltY = mousePosition.x * -10;
    const scale = 1.02;

    return `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`;
  };

  return (
    <div
      ref={cardRef}
      className={`interactive-card ${interactive ? 'card-interactive' : ''} ${className}`}
      style={{
        background: 'var(--color-card-background)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--border-radius)',
        padding: '1.5rem',
        boxShadow: isHovered ? getHoverShadow() : getShadow(),
        transform: getTiltTransform(),
        cursor: onClick && !disabled && !loading ? 'pointer' : 'default',
        opacity: disabled ? 0.6 : 1,
        position: 'relative',
        overflow: 'hidden',
        transition: 'all var(--transition-normal)',
        ...style,
      }}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if ((e.key === 'Enter' || e.key === ' ') && !disabled && !loading) {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {/* Loading overlay */}
      {loading && (
        <div className='loading-overlay'>
          <div className='loading-spinner'>
            <div className='spinner'></div>
          </div>
        </div>
      )}

      {/* Glow effect */}
      {glow && isHovered && <div className='glow-effect' />}

      {/* Shimmer effect on hover */}
      {interactive && isHovered && !loading && <div className='shimmer-effect' />}

      {/* Content */}
      <div className='card-content' style={{ opacity: loading ? 0.3 : 1 }}>
        {children}
      </div>

      <style>{`
        .interactive-card {
          transform-style: preserve-3d;
        }

        .interactive-card:focus {
          outline: none;
          box-shadow: ${getHoverShadow()}, 0 0 0 3px rgba(59, 130, 246, 0.3);
        }

        .loading-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: blur(2px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
        }

        .loading-spinner {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .spinner {
          width: 2rem;
          height: 2rem;
          border: 3px solid var(--color-border);
          border-top-color: var(--color-primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .glow-effect {
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          background: linear-gradient(
            45deg,
            var(--color-primary),
            var(--color-secondary),
            var(--color-accent),
            var(--color-primary)
          );
          background-size: 300% 300%;
          border-radius: inherit;
          z-index: -1;
          animation: glowPulse 3s ease-in-out infinite;
          opacity: 0.6;
        }

        @keyframes glowPulse {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        .shimmer-effect {
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.2),
            transparent
          );
          animation: shimmer 1.5s ease-in-out;
          pointer-events: none;
        }

        @keyframes shimmer {
          0% { left: -100%; }
          100% { left: 100%; }
        }

        .card-content {
          position: relative;
          z-index: 2;
          transition: opacity var(--transition-fast);
        }

        /* Enhanced focus styles for accessibility */
        .interactive-card[role="button"]:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }

        /* Reduce motion support */
        @media (prefers-reduced-motion: reduce) {
          .interactive-card {
            transition: box-shadow var(--transition-fast), opacity var(--transition-fast);
            transform: none !important;
          }
          
          .glow-effect,
          .shimmer-effect,
          .spinner {
            animation: none;
          }
        }

        /* Dark mode adjustments */
        [data-theme="dark"] .loading-overlay {
          background: rgba(17, 24, 39, 0.8);
        }
      `}</style>
    </div>
  );
};
