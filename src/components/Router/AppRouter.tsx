import React, { Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

// Components
import { ComingSoonPage } from '../Pages/ComingSoonPage';
import { RunsPage } from '../Pages/RunsPage';
import { GoalsPage } from '../../pages/GoalsPage';
import { StatsPage } from '../../pages/StatsPage';

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
        {/* Root redirect */}
        <Route path='/' element={<Navigate to={ROUTES.runs.path} replace />} />

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
        <Route path='*' element={<Navigate to={ROUTES.runs.path} replace />} />
      </Routes>
    </Suspense>
  );
};
