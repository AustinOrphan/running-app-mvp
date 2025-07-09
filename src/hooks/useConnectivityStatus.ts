import { useState, useEffect, useCallback, useRef } from 'react';

export type ConnectivityStatus = 'healthy' | 'connecting' | 'disconnected' | 'loading';

export interface ConnectivityState {
  status: ConnectivityStatus;
  lastChecked: Date | null;
  lastSuccessful: Date | null;
  retryCount: number;
  error?: string;
}

export interface ConnectivityActions {
  checkHealth: () => Promise<void>;
  retry: () => Promise<void>;
}

const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const MAX_RETRY_COUNT = 3;
const RETRY_DELAY = 2000; // 2 seconds

export const useConnectivityStatus = (): ConnectivityState & ConnectivityActions => {
  const [state, setState] = useState<ConnectivityState>({
    status: 'loading',
    lastChecked: null,
    lastSuccessful: null,
    retryCount: 0,
  });

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const checkHealth = useCallback(async (): Promise<void> => {
    // Only show connecting state if we're not in an error state
    setState(prev => ({
      ...prev,
      status:
        prev.status === 'disconnected'
          ? 'connecting'
          : prev.status === 'loading'
            ? 'connecting'
            : prev.status,
    }));

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('/api/health', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const now = new Date();
        setState(prev => ({
          ...prev,
          status: 'healthy',
          lastChecked: now,
          lastSuccessful: now,
          retryCount: 0,
          error: undefined,
        }));
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      let errorMessage = 'Connection failed';

      if (error instanceof Error) {
        const { name, message } = error;
        if (name === 'AbortError') {
          errorMessage = 'Request timeout (5s)';
        } else if (message.includes('Failed to fetch')) {
          errorMessage = 'Backend server not running';
        } else {
          errorMessage = message;
        }
      }

      setState(prev => ({
        ...prev,
        status: 'disconnected',
        lastChecked: new Date(),
        retryCount: prev.retryCount + 1,
        error: errorMessage,
      }));
    }
  }, []);

  const retry = useCallback(async (): Promise<void> => {
    if (stateRef.current.retryCount >= MAX_RETRY_COUNT) {
      // Reset retry count and try again
      setState(prev => ({ ...prev, retryCount: 0 }));
    }

    await checkHealth();
  }, [checkHealth]);

  // Initial health check with delay to prevent immediate failure blocking UI
  useEffect(() => {
    const timer = setTimeout(() => {
      checkHealth();
    }, 1000); // 1 second delay to let the app render first

    return () => clearTimeout(timer);
  }, [checkHealth]);

  // Periodic health checks
  useEffect(() => {
    const interval = setInterval(() => {
      // Only check if we're not currently connecting and app is visible
      if (state.status !== 'connecting' && !document.hidden) {
        checkHealth();
      }
    }, HEALTH_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [checkHealth, state.status]);

  // Auto-retry logic for failed connections
  useEffect(() => {
    if (state.status === 'disconnected' && state.retryCount < MAX_RETRY_COUNT) {
      const timeout = setTimeout(
        () => {
          retry();
        },
        RETRY_DELAY * Math.pow(2, state.retryCount)
      ); // Exponential backoff

      return () => clearTimeout(timeout);
    }
  }, [state.status, state.retryCount, retry]);

  // Online/offline event listeners
  useEffect(() => {
    const handleOnline = () => {
      checkHealth();
    };

    const handleOffline = () => {
      setState(prev => ({
        ...prev,
        status: 'disconnected',
        lastChecked: new Date(),
        error: 'Network connection lost',
      }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkHealth]);

  return {
    ...state,
    checkHealth,
    retry,
  };
};
