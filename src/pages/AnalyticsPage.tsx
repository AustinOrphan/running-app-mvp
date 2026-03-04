import React, { useState, Suspense, lazy } from 'react';
import { useAuth } from '../hooks/useAuth';

// Analytics Components — eagerly loaded (shown on default Overview tab)
import { StatsDashboard } from '../components/Analytics/StatsDashboard';
import { TrendChart } from '../components/Analytics/TrendChart';
import { TrendInsight } from '../components/Analytics/TrendInsight';
import { InsightsFeed } from '../components/Analytics/InsightsFeed';
import { useAnalyticsTrends } from '../hooks/useAnalyticsTrends';

// Lazily loaded — HeatmapMap uses canvas rendering and is only needed when Map tab is active
const HeatmapMap = lazy(() =>
  import('../components/Analytics/HeatmapMap').then(m => ({ default: m.HeatmapMap }))
);

const MapTabLoader: React.FC = () => (
  <div className='map-tab-loader' role='status' aria-label='Loading map'>
    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-secondary)' }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗺️</div>
      <div>Loading map...</div>
    </div>
  </div>
);

type TabType = 'overview' | 'trends' | 'insights' | 'map';

interface TabConfig {
  id: TabType;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'trends', label: 'Trends', icon: '📈' },
  { id: 'insights', label: 'Insights', icon: '💡' },
  { id: 'map', label: 'Map', icon: '🗺️' },
];

export const AnalyticsPage: React.FC = () => {
  const { getToken } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const { trends, loading: trendsLoading } = useAnalyticsTrends(getToken(), 'weekly', 12);

  return (
    <div className='analytics-page'>
      <header className='analytics-header'>
        <div className='header-content'>
          <h1 className='analytics-title'>Analytics</h1>
          <p className='analytics-subtitle'>Track your performance and get personalized insights</p>
        </div>
      </header>

      {/* Tab Navigation */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role */}
      <nav className='analytics-tabs' role='tablist' aria-label='Analytics sections'>
        {TABS.map(tab => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role='tab'
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            className={`analytics-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            tabIndex={activeTab === tab.id ? 0 : -1}
          >
            <span className='tab-icon' aria-hidden='true'>
              {tab.icon}
            </span>
            <span className='tab-label'>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Tab Content */}
      <div className='analytics-content'>
        {activeTab === 'overview' && (
          <div
            id='panel-overview'
            role='tabpanel'
            aria-labelledby='tab-overview'
            className='tab-panel fade-in'
            tabIndex={0}
          >
            <section className='analytics-section'>
              <StatsDashboard />
            </section>
          </div>
        )}

        {activeTab === 'trends' && (
          <div
            id='panel-trends'
            role='tabpanel'
            aria-labelledby='tab-trends'
            className='tab-panel fade-in'
            tabIndex={0}
          >
            <section className='analytics-section'>
              <TrendInsight trends={trends} loading={trendsLoading} />
            </section>
            <section className='analytics-section'>
              <TrendChart period='3m' height={350} />
            </section>
          </div>
        )}

        {activeTab === 'insights' && (
          <div
            id='panel-insights'
            role='tabpanel'
            aria-labelledby='tab-insights'
            className='tab-panel fade-in'
            tabIndex={0}
          >
            <section className='analytics-section'>
              <InsightsFeed />
            </section>
          </div>
        )}

        {activeTab === 'map' && (
          <div
            id='panel-map'
            role='tabpanel'
            aria-labelledby='tab-map'
            className='tab-panel fade-in'
            tabIndex={0}
          >
            <section className='analytics-section'>
              <Suspense fallback={<MapTabLoader />}>
                <HeatmapMap />
              </Suspense>
            </section>
          </div>
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
};

const styles = `
  .analytics-page {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1rem 2rem;
  }

  .analytics-header {
    padding: 2rem 0 1.5rem;
  }

  .header-content {
    text-align: center;
  }

  @media (min-width: 768px) {
    .header-content {
      text-align: left;
    }
  }

  .analytics-title {
    margin: 0 0 0.5rem 0;
    font-size: 2rem;
    font-weight: 700;
    color: var(--color-text-primary);
    background: linear-gradient(135deg, var(--color-primary), var(--color-success));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  @media (min-width: 768px) {
    .analytics-title {
      font-size: 2.5rem;
    }
  }

  .analytics-subtitle {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: 1rem;
  }

  .analytics-tabs {
    display: flex;
    gap: 0.5rem;
    background: var(--color-background-subtle);
    padding: 0.5rem;
    border-radius: var(--border-radius);
    margin-bottom: 2rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .analytics-tab {
    flex: 1;
    min-width: 100px;
    padding: 0.875rem 1.25rem;
    border: 2px solid transparent;
    border-radius: calc(var(--border-radius) - 2px);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    white-space: nowrap;
  }

  .analytics-tab:hover:not(.active) {
    background: var(--color-background);
    color: var(--color-text-primary);
  }

  .analytics-tab.active {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
  }

  .tab-icon {
    font-size: 1.25rem;
    line-height: 1;
  }

  .tab-label {
    font-size: 0.9rem;
  }

  @media (max-width: 640px) {
    .tab-label {
      display: none;
    }

    .analytics-tab {
      flex: 0 0 auto;
      min-width: 60px;
      padding: 0.875rem;
    }

    .tab-icon {
      font-size: 1.5rem;
    }
  }

  .analytics-content {
    position: relative;
    min-height: 400px;
  }

  .tab-panel {
    width: 100%;
  }

  .analytics-section {
    margin-bottom: 2rem;
  }

  .analytics-section:last-child {
    margin-bottom: 0;
  }

  .fade-in {
    animation: fadeIn 0.3s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Scrollbar styling for tabs */
  .analytics-tabs::-webkit-scrollbar {
    height: 4px;
  }

  .analytics-tabs::-webkit-scrollbar-track {
    background: transparent;
  }

  .analytics-tabs::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 2px;
  }

  .analytics-tabs::-webkit-scrollbar-thumb:hover {
    background: var(--color-text-secondary);
  }
`;
