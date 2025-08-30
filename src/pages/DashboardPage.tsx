import React from 'react';
import { useRuns } from '../hooks/useRuns';
import { useGoals } from '../hooks/useGoals';
import { useAuth } from '../hooks/useAuth';

// Dashboard components
import { QuickStatsWidget } from '../components/Dashboard/QuickStatsWidget';
import { RecentRunsWidget } from '../components/Dashboard/RecentRunsWidget';
import { GoalProgressWidget } from '../components/Dashboard/GoalProgressWidget';
import { QuickActionsWidget } from '../components/Dashboard/QuickActionsWidget';
import { WeeklyInsightWidget } from '../components/Dashboard/WeeklyInsightWidget';
import { ActivityHeatmap } from '../components/Dashboard/ActivityHeatmap';

// Styles
import styles from '../styles/components/Dashboard.module.css';

interface DashboardPageProps {
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onShowToast }) => {
  const { getToken } = useAuth();
  const { runs, loading: runsLoading } = useRuns(getToken());
  const { goals, loading: goalsLoading } = useGoals(getToken());

  // Individual loading states for progressive loading
  const loading = runsLoading || goalsLoading;

  return (
    <div className={styles.dashboard}>
      <header className={styles.dashboardHeader}>
        <h1 className={styles.dashboardTitle}>Dashboard</h1>
        <p className={styles.dashboardSubtitle}>Welcome back! Here&apos;s your running overview</p>
      </header>

      <div className={styles.dashboardGrid}>
        {/* Quick Stats - Full width on mobile, half width on desktop */}
        <div className={`${styles.quickStatsSection} animate-fade-in-up animation-delay-100`}>
          <QuickStatsWidget runs={runs} loading={loading} />
        </div>

        {/* Weekly Insights */}
        <div className={`${styles.insightsSection} animate-fade-in-up animation-delay-200`}>
          <WeeklyInsightWidget runs={runs} loading={loading} />
        </div>

        {/* Quick Actions */}
        <div className={`${styles.actionsSection} animate-fade-in-up animation-delay-300`}>
          <QuickActionsWidget onShowToast={onShowToast} />
        </div>

        {/* Recent Runs */}
        <div className={`${styles.recentRunsSection} animate-fade-in-up animation-delay-400`}>
          <RecentRunsWidget runs={runs} loading={loading} />
        </div>

        {/* Goal Progress */}
        <div className={`${styles.goalProgressSection} animate-fade-in-up animation-delay-500`}>
          <GoalProgressWidget goals={goals} runs={runs} loading={loading} />
        </div>

        {/* Activity Heatmap - Full width */}
        <div className={`${styles.activityHeatmapSection} animate-fade-in-up animation-delay-600`}>
          <ActivityHeatmap runs={runs} weeks={12} loading={loading} />
        </div>
      </div>
    </div>
  );
};
