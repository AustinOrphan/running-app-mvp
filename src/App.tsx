import React, { useState, useEffect, useRef } from 'react';
import './styles/globals.css';
import './App.css';
import styles from './styles/components/App.module.css';
import layoutStyles from './styles/components/Layout.module.css';

// Components
import { AuthForm } from './components/Auth/AuthForm';
import { ConnectivityFooter } from './components/Connectivity/ConnectivityFooter';
import { Header } from './components/Navigation/Header';
import { SwipeHint } from './components/Navigation/SwipeHint';
import { TabNavigation } from './components/Navigation/TabNavigation';
import { ToastContainer } from './components/Toast/ToastContainer';
import { AppRouter } from './components/Router/AppRouter';

// Hooks
import { useAuth } from './hooks/useAuth';
import { useRuns } from './hooks/useRuns';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';
import { useToast } from './hooks/useToast';
import { useRouter } from './hooks/useRouter';
// Types
import { RouteKey } from './constants/navigation';

// Context
import { HealthCheckProvider, useHealthCheck } from './contexts/HealthCheckContext';

function AppContent() {
  const [swipeHighlight, setSwipeHighlight] = useState(false);
  const previousStatusRef = useRef<string | null>(null);
  const { currentRoute: activeTab, navigate: navigateToRoute } = useRouter();

  // Custom hooks
  const { isLoggedIn, loading: authLoading, login, register, logout, getToken } = useAuth();
  const { toasts, showToast, removeToast } = useToast();
  const { runs, loading: runsLoading, saving, saveRun, deleteRun } = useRuns(getToken());
  const { status } = useHealthCheck();

  const triggerSwipeHighlight = () => {
    setSwipeHighlight(true);
    setTimeout(() => {
      setSwipeHighlight(false);
    }, 600);
  };

  const handleTabChange = (tab: RouteKey) => {
    navigateToRoute(tab); // Type-safe navigation via useRouter hook
  };

  const { hasSwipedOnce, onTouchStart, onTouchMove, onTouchEnd } = useSwipeNavigation(
    activeTab,
    handleTabChange,
    triggerSwipeHighlight
  );

  useEffect(() => {
    // Only show toast on actual status changes, not initial load
    if (previousStatusRef.current !== null && previousStatusRef.current !== status) {
      if (status === 'healthy') {
        showToast('Connected to server', 'success');
      } else if (status === 'disconnected') {
        showToast('Backend server not running - some features may be limited', 'info');
      }
    }

    // Update the previous status
    previousStatusRef.current = status;
  }, [status, showToast]);

  const handleLogin = async (email: string, password: string) => {
    if (status === 'disconnected') {
      showToast('Cannot login - backend server is not running', 'error');
      return;
    }

    const result = await login(email, password);
    if (result.success) {
      showToast('Welcome back! Successfully logged in', 'success');
    } else {
      showToast(result.message || 'Login failed', 'error');
    }
  };

  const handleRegister = async (email: string, password: string) => {
    if (status === 'disconnected') {
      showToast('Cannot register - backend server is not running', 'error');
      return;
    }

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
      <div className={styles.app}>
        <h1>🏃‍♂️ Running Tracker</h1>

        {status === 'disconnected' && (
          <div className={layoutStyles.offlineNotice}>
            ⚠️ Backend server is not running. Start it with <code>npm run dev</code> in a separate
            terminal.
          </div>
        )}

        <AuthForm onLogin={handleLogin} onRegister={handleRegister} loading={authLoading} />

        <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
        <ConnectivityFooter
          disableFocusIndicator={true}
          additionalSections={[
            {
              id: 'welcome-info',
              title: 'Welcome',
              content: (
                <div className={layoutStyles.footerSectionContent}>
                  <div className={layoutStyles.footerInfoItem}>
                    <span className={layoutStyles.footerInfoLabel}>Status:</span>
                    <span className={layoutStyles.footerInfoValue}>Not logged in</span>
                  </div>
                  <div className={layoutStyles.footerInfoItem}>
                    <span className={layoutStyles.footerInfoLabel}>Features:</span>
                    <span className={layoutStyles.footerInfoValue}>Login to access</span>
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
    <div className={styles.app}>
      <Header onLogout={handleLogout} />

      <TabNavigation
        swipeHighlight={swipeHighlight}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />

      <SwipeHint show={!hasSwipedOnce} />

      <div className={layoutStyles.dashboard}>
        <div
          className={layoutStyles.tabContent}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <AppRouter
            isLoggedIn={isLoggedIn}
            runs={runs}
            runsLoading={runsLoading}
            saving={saving}
            onSaveRun={saveRun}
            onDeleteRun={deleteRun}
            onShowToast={(message, type) =>
              showToast(message, type as 'success' | 'error' | 'info')
            }
            token={getToken()}
          />
        </div>
      </div>

      <ToastContainer toasts={toasts} onRemoveToast={removeToast} />
      <ConnectivityFooter
        disableFocusIndicator={true}
        additionalSections={[
          {
            id: 'user-info',
            title: 'Session',
            content: (
              <div className={layoutStyles.footerInfoItem}>
                <span className={layoutStyles.footerInfoLabel}>Current Page:</span>
                <span className={layoutStyles.footerInfoValue}>{activeTab}</span>
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
