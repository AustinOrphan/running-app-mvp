import React from 'react';

interface SkeletonLoaderProps {
  type: 'text' | 'title' | 'circle' | 'chart' | 'progress' | 'heatmap' | 'stat-grid' | 'list-item';
  width?: string;
  height?: string;
  count?: number;
  className?: string;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  type,
  width,
  height,
  count = 1,
  className = '',
}) => {
  const renderSkeleton = () => {
    switch (type) {
      case 'text':
        return (
          <div
            className={`skeleton skeleton-text ${className}`}
            style={{ width: width || '100%', height: height || '1rem' }}
          />
        );

      case 'title':
        return (
          <div
            className={`skeleton skeleton-title ${className}`}
            style={{ width: width || '60%', height: height || '1.5rem' }}
          />
        );

      case 'circle':
        return (
          <div
            className={`skeleton skeleton-circle ${className}`}
            style={{ width: width || '2rem', height: height || '2rem' }}
          />
        );

      case 'chart':
        return (
          <div
            className={`skeleton skeleton-chart ${className}`}
            style={{ width: width || '100%', height: height || '200px' }}
          />
        );

      case 'progress':
        return (
          <div className={`skeleton-progress-container ${className}`}>
            <div className='skeleton-progress-header'>
              <div className='skeleton skeleton-circle' style={{ width: '2rem', height: '2rem' }} />
              <div className='skeleton-progress-info'>
                <div
                  className='skeleton skeleton-text'
                  style={{ width: '120px', height: '1rem' }}
                />
                <div
                  className='skeleton skeleton-text'
                  style={{ width: '80px', height: '0.75rem' }}
                />
              </div>
              <div className='skeleton skeleton-text' style={{ width: '40px', height: '1rem' }} />
            </div>
            <div className='skeleton-progress-bar'>
              <div className='skeleton skeleton-text' style={{ width: '100%', height: '6px' }} />
            </div>
          </div>
        );

      case 'stat-grid':
        return (
          <div className='skeleton-stat-grid'>
            {Array.from({ length: count }).map((_, index) => (
              <div key={index} className='skeleton-stat-item'>
                <div
                  className='skeleton skeleton-circle'
                  style={{ width: '1.5rem', height: '1.5rem' }}
                />
                <div
                  className='skeleton skeleton-text'
                  style={{ width: '60px', height: '1.25rem' }}
                />
                <div
                  className='skeleton skeleton-text'
                  style={{ width: '40px', height: '0.75rem' }}
                />
              </div>
            ))}
          </div>
        );

      case 'list-item':
        return (
          <div className={`skeleton-list-item ${className}`}>
            <div className='skeleton skeleton-circle' style={{ width: '2rem', height: '2rem' }} />
            <div className='skeleton-list-content'>
              <div className='skeleton skeleton-text' style={{ width: '80%', height: '1rem' }} />
              <div className='skeleton skeleton-text' style={{ width: '60%', height: '0.75rem' }} />
            </div>
          </div>
        );

      case 'heatmap':
        return (
          <div className={`skeleton-heatmap ${className}`}>
            <div className='skeleton-heatmap-header'>
              <div className='skeleton skeleton-title' style={{ width: '150px' }} />
              <div className='skeleton skeleton-text' style={{ width: '80px' }} />
            </div>
            <div className='skeleton-heatmap-grid'>
              {Array.from({ length: 84 }).map((_, index) => (
                <div
                  key={index}
                  className='skeleton skeleton-heatmap-cell'
                  style={{
                    width: '12px',
                    height: '12px',
                    animationDelay: `${index * 0.01}s`,
                  }}
                />
              ))}
            </div>
          </div>
        );

      default:
        return (
          <div
            className={`skeleton ${className}`}
            style={{ width: width || '100%', height: height || '1rem' }}
          />
        );
    }
  };

  if (count > 1 && type !== 'stat-grid' && type !== 'heatmap') {
    return (
      <div className='skeleton-group'>
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} style={{ marginBottom: '0.5rem' }}>
            {renderSkeleton()}
          </div>
        ))}
      </div>
    );
  }

  return <>{renderSkeleton()}</>;
};

// CSS styles for skeleton components
export const SkeletonStyles = () => (
  <style>{`
    .skeleton {
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
      border-radius: 4px;
    }

    .skeleton-text {
      height: 1rem;
      margin-bottom: 0.25rem;
    }

    .skeleton-title {
      height: 1.5rem;
      margin-bottom: 0.75rem;
    }

    .skeleton-circle {
      border-radius: 50%;
    }

    .skeleton-chart {
      border-radius: 8px;
    }

    .skeleton-progress-container {
      padding: 1rem;
      border-radius: var(--border-radius);
      background: var(--color-background-subtle);
    }

    .skeleton-progress-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .skeleton-progress-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .skeleton-progress-bar {
      width: 100%;
      height: 6px;
      background: var(--color-background);
      border-radius: 3px;
      overflow: hidden;
    }

    .skeleton-stat-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }

    @media (min-width: 768px) {
      .skeleton-stat-grid {
        grid-template-columns: repeat(4, 1fr);
      }
    }

    .skeleton-stat-item {
      text-align: center;
      padding: 1rem;
      border-radius: var(--border-radius);
      background: var(--color-background-subtle);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }

    .skeleton-list-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      border-radius: var(--border-radius);
      background: var(--color-background-subtle);
      margin-bottom: 0.75rem;
    }

    .skeleton-list-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .skeleton-heatmap {
      background: var(--color-background-subtle);
      border-radius: var(--border-radius);
      padding: 1.5rem;
    }

    .skeleton-heatmap-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .skeleton-heatmap-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 2px;
      max-width: 100%;
      overflow-x: auto;
    }

    .skeleton-heatmap-cell {
      border-radius: 2px;
    }

    .skeleton-group {
      display: flex;
      flex-direction: column;
    }

    /* Dark mode skeleton styles */
    @media (prefers-color-scheme: dark) {
      .skeleton {
        background: linear-gradient(90deg, #2a2a2a 25%, #1a1a1a 50%, #2a2a2a 75%);
        background-size: 200% 100%;
      }
    }

    /* Reduced motion */
    @media (prefers-reduced-motion: reduce) {
      .skeleton {
        animation: none;
        background: #f0f0f0;
      }

      @media (prefers-color-scheme: dark) {
        .skeleton {
          background: #2a2a2a;
        }
      }
    }
  `}</style>
);
