import React from 'react';

import { GoalsOverviewCard } from '../components/Stats/GoalsOverviewCard';
import { InsightsCard } from '../components/Stats/InsightsCard';
import { PersonalRecordsTable } from '../components/Stats/PersonalRecordsTable';
import { RunTypeBreakdownChart } from '../components/Stats/RunTypeBreakdownChart';
import { TrendsChart } from '../components/Stats/TrendsChart';
import { useGoals } from '../hooks/useGoals';
import { useStats } from '../hooks/useStats';

interface StatsPageProps {
  token: string | null;
}

export const StatsPage: React.FC<StatsPageProps> = ({ token }) => {
  const { weeklyInsights, typeBreakdown, trendsData, personalRecords, loading, error } =
    useStats(token);
  const { goals, goalProgress, loading: goalsLoading } = useGoals(token);

  if (error) {
    return (
      <div className='error-container'>
        <div className='error-icon'>⚠️</div>
        <h3>Failed to load statistics</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className='stats-page tab-panel'>
      <div className='stats-header'>
        <h2>Statistics</h2>
        <p>Track your running progress and insights</p>
      </div>

      <div className='stats-grid'>
        <InsightsCard insights={weeklyInsights} loading={loading} />
        <GoalsOverviewCard goals={goals} goalProgress={goalProgress} loading={goalsLoading} />
        <RunTypeBreakdownChart data={typeBreakdown} loading={loading} />
        <TrendsChart data={trendsData} loading={loading} />
        <PersonalRecordsTable records={personalRecords} loading={loading} />
      </div>
    </div>
  );
};
