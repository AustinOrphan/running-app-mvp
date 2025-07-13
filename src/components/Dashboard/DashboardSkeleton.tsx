import React from 'react';
import { SkeletonLoader, SkeletonStyles } from './SkeletonLoader';
import styles from '../../styles/components/Dashboard.module.css';

export const DashboardSkeleton: React.FC = () => {
  return (
    <div className={styles.dashboard}>
      <SkeletonStyles />

      {/* Header skeleton */}
      <header className={styles.dashboardHeader}>
        <div style={{ textAlign: 'center' }}>
          <SkeletonLoader type='title' width='200px' height='2rem' />
          <SkeletonLoader type='text' width='300px' height='1rem' />
        </div>
      </header>

      {/* Dashboard grid skeleton */}
      <div className={styles.dashboardGrid}>
        {/* Quick Stats skeleton */}
        <div className={`${styles.quickStatsSection} ${styles.widget}`}>
          <div className={styles.widgetHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>📊</span>
              <SkeletonLoader type='text' width='100px' height='1.125rem' />
            </div>
          </div>
          <div className={styles.widgetContent}>
            <SkeletonLoader type='stat-grid' count={4} />
            <div
              style={{
                marginTop: '1.5rem',
                paddingTop: '1.5rem',
                borderTop: '1px solid var(--color-border)',
              }}
            >
              <SkeletonLoader type='text' width='150px' height='0.75rem' />
              <div style={{ marginTop: '0.75rem' }}>
                <SkeletonLoader type='chart' height='50px' />
              </div>
            </div>
          </div>
        </div>

        {/* Weekly Insights skeleton */}
        <div className={`${styles.insightsSection} ${styles.widget}`}>
          <div className={styles.widgetHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>📈</span>
              <SkeletonLoader type='text' width='120px' height='1.125rem' />
            </div>
          </div>
          <div className={styles.widgetContent}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}
            >
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  style={{
                    padding: '0.75rem',
                    borderRadius: 'var(--border-radius)',
                    background: 'var(--color-background-subtle)',
                    textAlign: 'center',
                  }}
                >
                  <SkeletonLoader type='text' width='60px' height='1.25rem' />
                  <SkeletonLoader type='text' width='40px' height='0.75rem' />
                </div>
              ))}
            </div>
            <SkeletonLoader type='text' width='80%' height='1rem' />
          </div>
        </div>

        {/* Quick Actions skeleton */}
        <div className={`${styles.actionsSection} ${styles.widget}`}>
          <div className={styles.widgetHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>⚡</span>
              <SkeletonLoader type='text' width='100px' height='1.125rem' />
            </div>
          </div>
          <div className={styles.widgetContent}>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '1rem',
                    borderRadius: 'var(--border-radius)',
                    background: 'var(--color-background-subtle)',
                  }}
                >
                  <SkeletonLoader type='circle' width='2.5rem' height='2.5rem' />
                  <div style={{ flex: 1 }}>
                    <SkeletonLoader type='text' width='80px' height='1rem' />
                    <SkeletonLoader type='text' width='120px' height='0.75rem' />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Runs skeleton */}
        <div className={`${styles.recentRunsSection} ${styles.widget}`}>
          <div className={styles.widgetHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🏃‍♂️</span>
              <SkeletonLoader type='text' width='100px' height='1.125rem' />
            </div>
          </div>
          <div className={styles.widgetContent}>
            <SkeletonLoader type='list-item' count={3} />
          </div>
        </div>

        {/* Goal Progress skeleton */}
        <div className={`${styles.goalProgressSection} ${styles.widget}`}>
          <div className={styles.widgetHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🎯</span>
              <SkeletonLoader type='text' width='110px' height='1.125rem' />
            </div>
          </div>
          <div className={styles.widgetContent}>
            <SkeletonLoader type='progress' count={3} />
          </div>
        </div>

        {/* Activity Heatmap skeleton */}
        <div className={`${styles.activityHeatmapSection}`}>
          <SkeletonLoader type='heatmap' />
        </div>
      </div>
    </div>
  );
};
