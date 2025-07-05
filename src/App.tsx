import React, { useState, useEffect } from 'react';
import './App.css';

// Components
import { AuthForm } from './components/Auth/AuthForm';
import { ConnectivityFooter } from './components/Connectivity/ConnectivityFooter';
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

// Context
import { HealthCheckProvider, useHealthCheck } from './contexts/HealthCheckContext';

function AppContent() {
  const [activeTab, setActiveTab] = useState('runs');
  const [swipeHighlight, setSwipeHighlight] = useState(false);

  // Custom hooks
  const { isLoggedIn, loading: authLoading, login, register, logout, getToken } = useAuth();
  const { toasts, showToast, removeToast } = useToast();
  const { runs, loading: runsLoading, saving, saveRun, deleteRun } = useRuns(getToken());
  const { healthStatus, status } = useHealthCheck();

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
    // Show toast when connection status changes
    if (status === 'healthy') {
      showToast('Connected to server', 'success');
    } else if (status === 'disconnected') {
      showToast('Failed to connect to server', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

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
        <ConnectivityFooter
          additionalSections={[
            {
              id: 'welcome-info',
              title: 'Welcome',
              content: (
                <div className='footer-section-content'>
                  <div className='footer-info-item'>
                    <span className='footer-info-label'>Status:</span>
                    <span className='footer-info-value'>Not logged in</span>
                  </div>
                  <div className='footer-info-item'>
                    <span className='footer-info-label'>Features:</span>
                    <span className='footer-info-value'>Login to access</span>
                  </div>
                </div>
              ),
            },
          ]}
          customLinks={[
            {
              label: 'Create Account',
              href: '/register',
              onClick: e => {
                e.preventDefault();
                showToast('Use the registration form above to create an account!', 'info');
              },
            },
            {
              label: 'Privacy Policy',
              href: '/privacy',
              onClick: e => {
                e.preventDefault();
                showToast('Privacy policy feature coming soon!', 'info');
              },
            },
            {
              label: 'About Running Tracker',
              href: '/about',
              onClick: e => {
                e.preventDefault();
                showToast('Track your runs, set goals, and improve your performance!', 'info');
              },
            },
          ]}
        />
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
      <ConnectivityFooter
        additionalSections={[
          {
            id: 'user-info',
            title: 'Session',
            content: (
              <div className='footer-info-item'>
                <span className='footer-info-label'>Logged in since:</span>
                <span className='footer-info-value'>{new Date().toLocaleDateString()}</span>
              </div>
            ),
          },
        ]}
        customLinks={[
          {
            label: 'Privacy Policy',
            href: '/privacy',
            onClick: e => {
              e.preventDefault();
              showToast('Privacy policy feature coming soon!', 'info');
            },
          },
          {
            label: 'Help & Support',
            href: '/help',
            onClick: e => {
              e.preventDefault();
              showToast('Help system feature coming soon!', 'info');
            },
          },
          {
            label: 'About',
            href: '/about',
            onClick: e => {
              e.preventDefault();
              showToast('About page feature coming soon!', 'info');
            },
          },
        ]}
      />
    </div>
  );
}

function App() {
  return (
    <HealthCheckProvider>
      <AppContent />
    </HealthCheckProvider>
  );
}

export default App;
