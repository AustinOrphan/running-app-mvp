import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const { theme, actualTheme, toggleTheme } = useTheme();

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return '☀️';
      case 'dark':
        return '🌙';
      case 'system':
        return actualTheme === 'dark' ? '🌙' : '☀️';
      default:
        return '☀️';
    }
  };

  const getThemeLabel = () => {
    switch (theme) {
      case 'light':
        return 'Light Mode';
      case 'dark':
        return 'Dark Mode';
      case 'system':
        return `System (${actualTheme})`;
      default:
        return 'Light Mode';
    }
  };

  const getNextThemeLabel = () => {
    switch (theme) {
      case 'light':
        return 'Switch to Dark Mode';
      case 'dark':
        return 'Switch to System Mode';
      case 'system':
        return 'Switch to Light Mode';
      default:
        return 'Switch Theme';
    }
  };

  return (
    <button
      onClick={toggleTheme}
      className={`theme-toggle ${className}`}
      title={getNextThemeLabel()}
      aria-label={getNextThemeLabel()}
    >
      <span className='theme-toggle-icon' role='img' aria-hidden='true'>
        {getThemeIcon()}
      </span>
      <span className='theme-toggle-label'>{getThemeLabel()}</span>

      <style>{`
        .theme-toggle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          background: var(--color-card-background);
          border: 1px solid var(--color-border);
          border-radius: var(--border-radius);
          color: var(--color-text-primary);
          font-size: 0.875rem;
          font-weight: var(--font-weight-medium);
          cursor: pointer;
          transition: all var(--transition-fast);
          white-space: nowrap;
        }

        .theme-toggle:hover {
          background: var(--color-background-hover);
          border-color: var(--color-border-strong);
          transform: translateY(-1px);
          box-shadow: var(--shadow-sm);
        }

        .theme-toggle:active {
          transform: translateY(0);
          box-shadow: none;
        }

        .theme-toggle:focus {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }

        .theme-toggle-icon {
          font-size: 1rem;
          line-height: 1;
          transition: transform var(--transition-fast);
        }

        .theme-toggle:hover .theme-toggle-icon {
          transform: scale(1.1);
        }

        .theme-toggle-label {
          font-size: 0.875rem;
          line-height: 1;
        }

        /* Compact variant for small screens */
        @media (max-width: 640px) {
          .theme-toggle-compact .theme-toggle-label {
            display: none;
          }
          
          .theme-toggle-compact {
            padding: 0.5rem;
            min-width: 2.5rem;
            justify-content: center;
          }
        }

        /* High contrast mode support */
        @media (prefers-contrast: high) {
          .theme-toggle {
            border-width: 2px;
          }
        }

        /* Reduced motion support */
        @media (prefers-reduced-motion: reduce) {
          .theme-toggle,
          .theme-toggle-icon {
            transition: none;
          }
          
          .theme-toggle:hover {
            transform: none;
          }
          
          .theme-toggle:hover .theme-toggle-icon {
            transform: none;
          }
        }
      `}</style>
    </button>
  );
};

// Compact version for mobile/tight spaces
export const ThemeToggleCompact: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  return <ThemeToggle className={`theme-toggle-compact ${className}`} />;
};
