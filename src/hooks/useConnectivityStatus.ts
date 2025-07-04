import { useState, useEffect, useCallback } from 'react';

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

  const checkHealth = useCallback(async (): Promise<void> => {
    setState(prev => ({ ...prev, status: 'connecting' }));

    try {
      const response = await fetch('/api/health', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        // Add timeout to prevent hanging requests
        signal: AbortSignal.timeout(5000),
      });

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
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
    if (state.retryCount >= MAX_RETRY_COUNT) {
      // Reset retry count and try again
      setState(prev => ({ ...prev, retryCount: 0 }));
    }
    
    await checkHealth();
  }, [checkHealth, state.retryCount]);

  // Initial health check
  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  // Periodic health checks
  useEffect(() => {
    const interval = setInterval(() => {
      // Only check if we're not currently connecting
      if (state.status !== 'connecting') {
        checkHealth();
      }
    }, HEALTH_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [checkHealth, state.status]);

  // Auto-retry logic for failed connections
  useEffect(() => {
    if (state.status === 'disconnected' && state.retryCount < MAX_RETRY_COUNT) {
      const timeout = setTimeout(() => {
        retry();
      }, RETRY_DELAY * Math.pow(2, state.retryCount)); // Exponential backoff

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