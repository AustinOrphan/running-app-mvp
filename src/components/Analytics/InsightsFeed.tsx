import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useAnalyticsInsights } from '../../hooks/useAnalyticsInsights';
import { InsightCard } from './InsightCard';
import { Insight } from '../../types';

export const InsightsFeed: React.FC = () => {
  const { getToken } = useAuth();
  const { insights, loading, error, refetch } = useAnalyticsInsights(getToken());
  const [dismissedInsights, setDismissedInsights] = useState<Set<string>>(new Set());

  // Load dismissed insights from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('dismissedInsights');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setDismissedInsights(new Set(parsed));
      } catch {
        // Ignore parsing errors
      }
    }
  }, []);

  const handleDismiss = (insight: Insight) => {
    const key = `${insight.type}-${insight.message}`;
    const newDismissed = new Set(dismissedInsights);
    newDismissed.add(key);
    setDismissedInsights(newDismissed);

    // Persist to localStorage
    localStorage.setItem('dismissedInsights', JSON.stringify(Array.from(newDismissed)));
  };

  const handleRefresh = () => {
    // Clear dismissed insights on manual refresh
    setDismissedInsights(new Set());
    localStorage.removeItem('dismissedInsights');
    refetch();
  };

  if (loading) {
    return (
      <div className="insights-feed">
        <div className="insights-feed-header">
          <h3>Insights & Recommendations</h3>
          <button className="refresh-button" disabled aria-label="Loading insights" aria-busy="true">
            <span className="refresh-icon spinning" aria-hidden="true">🔄</span>
          </button>
        </div>
        <div className="insights-list">
          {[1, 2, 3].map(i => (
            <div key={i} className="insight-skeleton">
              <div className="skeleton-line" style={{ width: '100%', height: '120px' }}></div>
            </div>
          ))}
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="insights-feed">
        <div className="insights-feed-header">
          <h3>Insights & Recommendations</h3>
          <button className="refresh-button" onClick={handleRefresh} aria-label="Refresh insights">
            <span className="refresh-icon" aria-hidden="true">🔄</span>
          </button>
        </div>
        <div className="insights-error">
          <div className="error-icon">⚠️</div>
          <div className="error-message">{error}</div>
          <button className="retry-button" onClick={handleRefresh}>
            Try Again
          </button>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  // Filter out dismissed insights
  const visibleInsights = insights.filter(insight => {
    const key = `${insight.type}-${insight.message}`;
    return !dismissedInsights.has(key);
  });

  // Group insights by priority
  const groupedInsights = {
    high: visibleInsights.filter(i => i.priority === 'high'),
    medium: visibleInsights.filter(i => i.priority === 'medium'),
    low: visibleInsights.filter(i => i.priority === 'low'),
  };

  const hasInsights = visibleInsights.length > 0;
  const totalDismissed = dismissedInsights.size;

  return (
    <div className="insights-feed">
      <div className="insights-feed-header">
        <div className="header-content">
          <h3>Insights & Recommendations</h3>
          {hasInsights && (
            <span className="insight-count">
              {visibleInsights.length} active
              {totalDismissed > 0 && <span className="dismissed-count"> · {totalDismissed} dismissed</span>}
            </span>
          )}
        </div>
        <button className="refresh-button" onClick={handleRefresh} title="Refresh insights">
          <span className="refresh-icon">🔄</span>
        </button>
      </div>

      {!hasInsights ? (
        <div className="insights-empty">
          <div className="empty-icon">✨</div>
          <div className="empty-message">
            {insights.length === 0 ? 'Keep running to get insights!' : 'All insights dismissed'}
          </div>
          <div className="empty-hint">
            {insights.length === 0
              ? 'We analyze your runs to provide personalized recommendations'
              : 'Click refresh to see your insights again'}
          </div>
        </div>
      ) : (
        <div className="insights-list">
          {groupedInsights.high.length > 0 && (
            <div className="insights-group">
              <div className="group-header">
                <span className="group-icon">🔴</span>
                <h4 className="group-title">High Priority</h4>
                <span className="group-count">{groupedInsights.high.length}</span>
              </div>
              {groupedInsights.high.map((insight, index) => (
                <InsightCard
                  key={`high-${index}`}
                  insight={insight}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}

          {groupedInsights.medium.length > 0 && (
            <div className="insights-group">
              <div className="group-header">
                <span className="group-icon">🟡</span>
                <h4 className="group-title">Medium Priority</h4>
                <span className="group-count">{groupedInsights.medium.length}</span>
              </div>
              {groupedInsights.medium.map((insight, index) => (
                <InsightCard
                  key={`medium-${index}`}
                  insight={insight}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}

          {groupedInsights.low.length > 0 && (
            <div className="insights-group">
              <div className="group-header">
                <span className="group-icon">🔵</span>
                <h4 className="group-title">Low Priority</h4>
                <span className="group-count">{groupedInsights.low.length}</span>
              </div>
              {groupedInsights.low.map((insight, index) => (
                <InsightCard
                  key={`low-${index}`}
                  insight={insight}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
};

const styles = `
  .insights-feed {
    background: var(--color-background-subtle);
    border-radius: var(--border-radius);
    padding: 1.5rem;
  }

  .insights-feed-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
    gap: 1rem;
  }

  .header-content {
    flex: 1;
  }

  .insights-feed-header h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .insight-count {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }

  .dismissed-count {
    opacity: 0.7;
  }

  .refresh-button {
    background: var(--color-background);
    border: 2px solid var(--color-border);
    border-radius: var(--border-radius);
    padding: 0.5rem;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .refresh-button:hover:not(:disabled) {
    border-color: var(--color-primary);
    background: var(--color-primary);
  }

  .refresh-button:hover:not(:disabled) .refresh-icon {
    transform: rotate(180deg);
  }

  .refresh-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .refresh-icon {
    font-size: 1.2rem;
    transition: transform 0.3s ease;
    display: block;
  }

  .refresh-icon.spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .insights-list {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .insights-group {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .group-icon {
    font-size: 1rem;
  }

  .group-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-text-primary);
    flex: 1;
  }

  .group-count {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    background: var(--color-background);
    padding: 0.25rem 0.5rem;
    border-radius: 12px;
    font-weight: 600;
  }

  .insights-empty {
    text-align: center;
    padding: 3rem 1rem;
    background: var(--color-background);
    border-radius: var(--border-radius);
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .empty-message {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: 0.5rem;
  }

  .empty-hint {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
    max-width: 400px;
    margin: 0 auto;
  }

  .insights-error {
    text-align: center;
    padding: 2rem;
    background: var(--color-background);
    border-radius: var(--border-radius);
    border: 2px solid var(--color-danger, #ef4444);
  }

  .error-icon {
    font-size: 2.5rem;
    margin-bottom: 1rem;
  }

  .error-message {
    color: var(--color-danger, #ef4444);
    font-weight: 500;
    margin-bottom: 1rem;
  }

  .retry-button {
    background: var(--color-danger, #ef4444);
    color: white;
    border: none;
    padding: 0.625rem 1.25rem;
    border-radius: var(--border-radius);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .retry-button:hover {
    background: var(--color-danger-dark, #dc2626);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
  }

  .retry-button:active {
    transform: translateY(0);
  }

  .insight-skeleton {
    background: var(--color-background);
    border-radius: var(--border-radius);
    padding: 1rem;
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

  @keyframes shimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }
`;
