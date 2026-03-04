import React from 'react';
import { InteractiveCard } from '../Interactive/InteractiveCard';

interface StatsCardProps {
  icon: string;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
  loading?: boolean;
  onClick?: () => void;
}

const StatsCardInner: React.FC<StatsCardProps> = ({
  icon,
  label,
  value,
  subValue,
  trend,
  color = 'var(--color-primary)',
  loading = false,
  onClick,
}) => {
  if (loading) {
    return (
      <div className='stats-card stats-card-loading'>
        <div className='stats-card-icon skeleton-line'></div>
        <div className='stats-card-value skeleton-line'></div>
        <div className='stats-card-label skeleton-line'></div>
        <style>{styles}</style>
      </div>
    );
  }

  const trendIcon = trend === 'up' ? '↗' : trend === 'down' ? '↘' : '';
  const trendColor =
    trend === 'up'
      ? 'var(--color-success)'
      : trend === 'down'
        ? 'var(--color-warning)'
        : 'var(--color-text-secondary)';

  return (
    <InteractiveCard
      className='stats-card'
      style={{ '--accent-color': color } as React.CSSProperties}
      elevation={1}
      interactive={!!onClick}
      onClick={onClick}
      tilt={true}
    >
      <div className='stats-card-icon'>{icon}</div>
      <div className='stats-card-value'>{value}</div>
      <div className='stats-card-label'>{label}</div>
      {subValue && (
        <div className='stats-card-subvalue' style={{ color: trendColor }}>
          {trendIcon} {subValue}
        </div>
      )}

      <style>{styles}</style>
    </InteractiveCard>
  );
};

export const StatsCard = React.memo(StatsCardInner);

const styles = `
  .stats-card {
    text-align: center;
    padding: 1.25rem;
    border-radius: var(--border-radius);
    background: var(--color-background-subtle);
    border: 2px solid transparent;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  }

  .stats-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--accent-color);
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .stats-card:hover::before {
    opacity: 1;
  }

  .stats-card:hover {
    border-color: var(--accent-color);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .stats-card-loading {
    pointer-events: none;
  }

  .stats-card-icon {
    font-size: 2rem;
    margin-bottom: 0.75rem;
    animation: icon-pulse 2s ease-in-out infinite;
  }

  @keyframes icon-pulse {
    0%, 100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.1);
    }
  }

  .stats-card-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--color-text-primary);
    margin-bottom: 0.5rem;
    line-height: 1.2;
  }

  .stats-card-label {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 500;
  }

  .stats-card-subvalue {
    font-size: 0.75rem;
    margin-top: 0.5rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
  }

  .skeleton-line {
    background: linear-gradient(
      90deg,
      var(--color-background-subtle) 25%,
      var(--color-border) 50%,
      var(--color-background-subtle) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 4px;
  }

  .stats-card-loading .stats-card-icon {
    width: 2rem;
    height: 2rem;
    margin: 0 auto 0.75rem;
  }

  .stats-card-loading .stats-card-value {
    width: 80%;
    height: 1.75rem;
    margin: 0 auto 0.5rem;
  }

  .stats-card-loading .stats-card-label {
    width: 60%;
    height: 0.8rem;
    margin: 0 auto;
  }

  @keyframes shimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }
`;
