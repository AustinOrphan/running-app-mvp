import React, { createContext, useContext, ReactNode } from 'react';
import { useConnectivityStatus, ConnectivityStatus } from '../hooks/useConnectivityStatus';

interface HealthCheckContextType {
  status: ConnectivityStatus;
  lastChecked: Date | null;
  lastSuccessful: Date | null;
  retryCount: number;
  error?: string;
  retry: () => Promise<void>;
  checkHealth: () => Promise<void>;
  // Legacy format for backward compatibility
  healthStatus: string;
}

const HealthCheckContext = createContext<HealthCheckContextType | undefined>(undefined);

interface HealthCheckProviderProps {
  children: ReactNode;
}

export const HealthCheckProvider: React.FC<HealthCheckProviderProps> = ({ children }) => {
  const connectivityState = useConnectivityStatus();

  // Convert new status format to legacy format for backward compatibility
  const getLegacyHealthStatus = (status: ConnectivityStatus): string => {
    switch (status) {
      case 'healthy':
        return '✅ Backend Connected';
      case 'connecting':
        return '🔄 Connecting...';
      case 'disconnected':
        return '❌ Backend Offline';
      case 'loading':
        return 'Checking...';
      default:
        return 'Unknown';
    }
  };

  const contextValue: HealthCheckContextType = {
    ...connectivityState,
    healthStatus: getLegacyHealthStatus(connectivityState.status),
  };

  return <HealthCheckContext.Provider value={contextValue}>{children}</HealthCheckContext.Provider>;
};

export const useHealthCheck = (): HealthCheckContextType => {
  const context = useContext(HealthCheckContext);
  if (context === undefined) {
    throw new Error('useHealthCheck must be used within a HealthCheckProvider');
  }
  return context;
};
