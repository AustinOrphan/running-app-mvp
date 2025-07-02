import React, { useState, useEffect } from 'react';
import './App.css';

// Components
import { AuthForm } from './components/Auth/AuthForm';
import { Header } from './components/Navigation/Header';
import { SwipeHint } from './components/Navigation/SwipeHint';
import { TabNavigation } from './components/Navigation/TabNavigation';
import { ComingSoonPage } from './components/Pages/ComingSoonPage';
import { RunsPage } from './components/Pages/RunsPage';
import { ToastContainer } from './components/Toast/ToastContainer';

// Hooks
import { useAuth } from './hooks/useAuth';
import { useRuns } from './hooks/useRuns';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';
import { useToast } from './hooks/useToast';
import { GoalsPage } from './pages/GoalsPage';
import { StatsPage } from './pages/StatsPage';

function App() {
  const [healthStatus, setHealthStatus] = useState<string>('Checking...');
  const [activeTab, setActiveTab] = useState('runs');
  const [swipeHighlight, setSwipeHighlight] = useState(false);

  // Custom hooks
  const { isLoggedIn, loading: authLoading, login, register, logout, getToken } = useAuth();
  const { toasts, showToast, removeToast } = useToast();
  const { runs, loading: runsLoading, saving, saveRun, deleteRun } = useRuns(getToken());

  const triggerSwipeHighlight = () => {
    setSwipeHighlight(true);
    setTimeout(() => {
      setSwipeHighlight(false);
    }, 600);
  };

  const { hasSwipedOnce, onTouchStart, onTouchMove, onTouchEnd } = useSwipeNavigation(
    activeTab,
    setActiveTab,
    triggerSwipeHighlight
  );

  useEffect(() => {
    // Check server health
    fetch('/api/health')
      .then(res => res.json())
      .then(_data => {
        setHealthStatus('✅ Backend Connected');
        showToast('Connected to server', 'success');
      })
      .catch(() => {
        setHealthStatus('❌ Backend Offline');
        showToast('Failed to connect to server', 'error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (email: string, password: string) => {
    const result = await login(email, password);
    if (result.success) {
      showToast('Welcome back! Successfully logged in', 'success');
    } else {
      showToast(result.message || 'Login failed', 'error');
    }
  };

  const handleRegister = async (email: string, password: string) => {
    const result = await register(email, password);
    if (result.success) {
      showToast('Account created successfully! Welcome to Running Tracker', 'success');
    } else {
      showToast(result.message || 'Registration failed', 'error');
    }
  };

  const handleLogout = () => {
    logout();
    showToast('You have been logged out', 'info');
  };

  if (!isLoggedIn) {
    return (
      <div className='app'>
        <h1>🏃‍♂️ Running Tracker</h1>
        <div className='status'>{healthStatus}</div>

        <AuthForm onLogin={handleLogin} onRegister={handleRegister} loading={authLoading} />

        <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
      </div>
    );
  }

  return (
    <div className='app'>
      <Header healthStatus={healthStatus} onLogout={handleLogout} />

      <TabNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        swipeHighlight={swipeHighlight}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />

      <SwipeHint show={!hasSwipedOnce} />

      <div className='dashboard'>
        <div
          className='tab-content'
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {activeTab === 'runs' && (
            <RunsPage
              runs={runs}
              loading={runsLoading}
              saving={saving}
              onSaveRun={saveRun}
              onDeleteRun={deleteRun}
              onShowToast={showToast}
            />
          )}

          {activeTab === 'goals' && <GoalsPage />}

          {activeTab === 'races' && (
            <ComingSoonPage
              title='Races'
              description='Track upcoming races, set target times, and record your results.'
              icon='🏆'
            />
          )}

          {activeTab === 'stats' && <StatsPage token={getToken()} />}
        </div>
      </div>

      <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
    </div>
  );
}

export default App;
