import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router';

// Eagerly-loaded components (critical path — default landing pages)
import { RunsPage } from '../Pages/RunsPage';
import { DashboardPage } from '../../pages/DashboardPage';

// Lazily-loaded components (code-split — not on the initial render path)
const ComingSoonPage = lazy(() =>
  import('../Pages/ComingSoonPage').then(m => ({ default: m.ComingSoonPage }))
);
const GoalsPage = lazy(() =>
  import('../../pages/GoalsPage').then(m => ({ default: m.GoalsPage }))
);
const StatsPage = lazy(() =>
  import('../../pages/StatsPage').then(m => ({ default: m.StatsPage }))
);
const AnalyticsPage = lazy(() =>
  import('../../pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage }))
);

// Types and constants
import { ROUTES } from '../../constants/navigation';

import { Run, RunFormData } from '../../types';

interface AppRouterProps {
  isLoggedIn: boolean;
  // Props for RunsPage
  runs: Run[];
  runsLoading: boolean;
  saving: boolean;
  onSaveRun: (formData: RunFormData, editingRun?: Run | null) => Promise<void>;
  onDeleteRun: (id: string) => Promise<void>;
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  // Props for StatsPage
  token: string | null;
}

// Loading component for route transitions
const RouteLoader: React.FC = () => (
  <div className='route-loader' role='status' aria-label='Loading page'>
    <div className='loading-spinner'>⏳</div>
    <span className='sr-only'>Loading...</span>
  </div>
);

// Route guard component
const ProtectedRoute: React.FC<{ children: React.ReactNode; isLoggedIn: boolean }> = ({
  children,
  isLoggedIn,
}) => {
  const location = useLocation();

  if (!isLoggedIn) {
    // Redirect to login with the attempted location
    return <Navigate to='/login' state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export const AppRouter: React.FC<AppRouterProps> = ({
  isLoggedIn,
  runs,
  runsLoading,
  saving,
  onSaveRun,
  onDeleteRun,
  onShowToast,
  token,
}) => {
  return (
    <Suspense fallback={<RouteLoader />}>
      <Routes>
        {/* Dashboard route */}
        <Route
          path={ROUTES.dashboard.path}
          element={
            <ProtectedRoute isLoggedIn={isLoggedIn}>
              <DashboardPage onShowToast={onShowToast} />
            </ProtectedRoute>
          }
        />

        {/* Protected routes */}
        <Route
          path={ROUTES.runs.path}
          element={
            <ProtectedRoute isLoggedIn={isLoggedIn}>
              <RunsPage
                runs={runs}
                loading={runsLoading}
                saving={saving}
                onSaveRun={onSaveRun}
                onDeleteRun={onDeleteRun}
                onShowToast={onShowToast}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path={ROUTES.goals.path}
          element={
            <ProtectedRoute isLoggedIn={isLoggedIn}>
              <GoalsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path={ROUTES.analytics.path}
          element={
            <ProtectedRoute isLoggedIn={isLoggedIn}>
              <AnalyticsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path={ROUTES.races.path}
          element={
            <ProtectedRoute isLoggedIn={isLoggedIn}>
              <ComingSoonPage
                title='Races'
                description='Track upcoming races, set target times, and record your results.'
                icon='🏆'
              />
            </ProtectedRoute>
          }
        />

        <Route
          path={ROUTES.stats.path}
          element={
            <ProtectedRoute isLoggedIn={isLoggedIn}>
              <StatsPage token={token} />
            </ProtectedRoute>
          }
        />

        {/* Catch-all route */}
        <Route path='*' element={<Navigate to={ROUTES.dashboard.path} replace />} />
      </Routes>
    </Suspense>
  );
};
