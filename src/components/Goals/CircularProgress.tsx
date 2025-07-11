import React from 'react';

import styles from '../../styles/components/Progress.module.css';

interface CircularProgressProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  backgroundColor?: string;
  children?: React.ReactNode;
  className?: string;
  animated?: boolean;
}

export const CircularProgress: React.FC<CircularProgressProps> = ({
  percentage,
  size = 120,
  strokeWidth = 8,
  color = '#3b82f6',
  backgroundColor = '#2a2a2a',
  children,
  className = '',
  animated = true,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const clamped = Math.max(0, Math.min(percentage, 100));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className={`${styles.circularProgress} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className={styles.circularProgressSvg}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={backgroundColor}
          strokeWidth={strokeWidth}
          fill='transparent'
          className={styles.progressBackground}
        />

        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill='transparent'
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap='round'
          className={`${styles.progressForeground} ${animated ? styles.animated : ''}`}
          style={{
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%',
            transition: animated ? 'stroke-dashoffset 0.5s ease-in-out' : 'none',
          }}
        />
      </svg>

      {/* Content overlay */}
      {children && <div className={styles.circularProgressContent}>{children}</div>}
    </div>
  );
};
