import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useHealthCheck } from '../../contexts/HealthCheckContext';
import { ConnectivityStatus } from '../../hooks/useConnectivityStatus';

interface ConnectivityFooterProps {
  className?: string;
}

const getStatusColor = (status: ConnectivityStatus): string => {
  switch (status) {
    case 'healthy':
      return '#10b981'; // Green
    case 'connecting':
      return '#f59e0b'; // Yellow
    case 'disconnected':
      return '#ef4444'; // Red
    case 'loading':
      return '#6b7280'; // Gray
    default:
      return '#6b7280';
  }
};

const STATUS_ICON = '●';

const getStatusText = (status: ConnectivityStatus): string => {
  switch (status) {
    case 'healthy':
      return 'Connected';
    case 'connecting':
      return 'Connecting...';
    case 'disconnected':
      return 'Disconnected';
    case 'loading':
      return 'Loading...';
    default:
      return 'Unknown';
  }
};

const formatTime = (date: Date | null): string => {
  if (!date) return 'Never';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const ConnectivityFooter: React.FC<ConnectivityFooterProps> = ({ className = '' }) => {
  const { status, lastChecked, lastSuccessful, retryCount, error, retry } = useHealthCheck();
  const [isExpanded, setIsExpanded] = useState(false);
  const autoCollapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-collapse after 3 seconds of inactivity
  const scheduleAutoCollapse = useCallback(() => {
    if (autoCollapseTimeoutRef.current) {
      clearTimeout(autoCollapseTimeoutRef.current);
    }

    const timeout = setTimeout(() => {
      setIsExpanded(false);
    }, 3000);

    autoCollapseTimeoutRef.current = timeout;
  }, []);

  const handleToggleExpanded = () => {
    setIsExpanded(prev => !prev);
    if (!isExpanded) {
      scheduleAutoCollapse();
    }
  };

  const handleRetry = async () => {
    await retry();
    scheduleAutoCollapse();
  };

  // Auto-expand briefly when status changes to disconnected
  useEffect(() => {
    if (status === 'disconnected') {
      setIsExpanded(true);
      scheduleAutoCollapse();
    }
  }, [status, scheduleAutoCollapse]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autoCollapseTimeoutRef.current) {
        clearTimeout(autoCollapseTimeoutRef.current);
      }
    };
  }, []);

  const statusColor = getStatusColor(status);
  const statusIcon = STATUS_ICON;
  const statusText = getStatusText(status);

  return (
    <div className={`connectivity-footer ${className}`}>
      {/* Thin status line */}
      <div
        className={`connectivity-line ${status}`}
        style={{ backgroundColor: statusColor }}
        onClick={handleToggleExpanded}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggleExpanded();
          }
        }}
        role='button'
        tabIndex={0}
        aria-label={`Connection status: ${statusText}. Click to expand details.`}
      />

      {/* Expanded details panel */}
      <div
        className={`connectivity-details ${isExpanded ? 'expanded' : ''}`}
        role='region'
        aria-label='Connection details'
      >
        <div className='connectivity-content'>
          <div className='connectivity-status'>
            <span className='status-indicator' style={{ color: statusColor }} aria-hidden='true'>
              {statusIcon}
            </span>
            <span className='status-text'>{statusText}</span>
          </div>

          <div className='connectivity-info'>
            <div className='info-row'>
              <span className='info-label'>Last checked:</span>
              <span className='info-value'>{formatTime(lastChecked)}</span>
            </div>

            {lastSuccessful && (
              <div className='info-row'>
                <span className='info-label'>Last successful:</span>
                <span className='info-value'>{formatTime(lastSuccessful)}</span>
              </div>
            )}

            {error && (
              <div className='info-row error'>
                <span className='info-label'>Error:</span>
                <span className='info-value'>{error}</span>
              </div>
            )}

            {retryCount > 0 && (
              <div className='info-row'>
                <span className='info-label'>Retry attempts:</span>
                <span className='info-value'>{retryCount}</span>
              </div>
            )}
          </div>

          {(status === 'disconnected' || status === 'connecting') && (
            <button
              className='retry-button'
              onClick={handleRetry}
              disabled={status === 'connecting'}
              aria-label='Retry connection'
            >
              {status === 'connecting' ? 'Retrying...' : 'Retry Connection'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
