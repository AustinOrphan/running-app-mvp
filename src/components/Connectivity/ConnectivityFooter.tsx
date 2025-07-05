import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useHealthCheck } from '../../contexts/HealthCheckContext';
import { ConnectivityStatus } from '../../hooks/useConnectivityStatus';
import { getAppVersion, getBuildDate, getEnvironment } from '../../utils/env';

interface FooterSection {
  id: string;
  title: string;
  content: React.ReactNode;
}

interface FooterLink {
  label: string;
  href: string;
  onClick?: (e: React.MouseEvent) => void;
}

interface ConnectivityFooterProps {
  className?: string;
  additionalSections?: FooterSection[];
  customLinks?: FooterLink[];
  disableFocusIndicator?: boolean;
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

export const ConnectivityFooter: React.FC<ConnectivityFooterProps> = ({
  className = '',
  additionalSections = [],
  customLinks = [],
  disableFocusIndicator = false,
}) => {
  const { status, lastChecked, lastSuccessful, retryCount, error, retry } = useHealthCheck();
  const [isExpanded, setIsExpanded] = useState(false);
  const autoCollapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  // App version info - safely access environment variables
  const appVersion = getAppVersion();
  const buildDate = getBuildDate();

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

  // Click outside to close footer
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (isExpanded && footerRef.current && !footerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
        if (autoCollapseTimeoutRef.current) {
          clearTimeout(autoCollapseTimeoutRef.current);
          autoCollapseTimeoutRef.current = null;
        }
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isExpanded]);

  // Escape key to close footer
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (isExpanded && event.key === 'Escape') {
        setIsExpanded(false);
        if (autoCollapseTimeoutRef.current) {
          clearTimeout(autoCollapseTimeoutRef.current);
          autoCollapseTimeoutRef.current = null;
        }
      }
    };

    if (isExpanded) {
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isExpanded]);

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
    <div ref={footerRef} className={`connectivity-footer ${className}`}>
      {/* Thin status line */}
      <div
        className={`connectivity-line ${status} ${disableFocusIndicator ? 'no-focus-indicator' : ''}`}
        onClick={handleToggleExpanded}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggleExpanded();
          }
        }}
        role='button'
        tabIndex={0}
        aria-label={`Footer: ${statusText}. Click to expand app details. Press Escape or click outside to close.`}
      />

      {/* Expanded details panel */}
      <div
        className={`connectivity-details ${isExpanded ? 'expanded' : ''}`}
        role='region'
        aria-label='App footer details'
      >
        <div className='connectivity-content'>
          <div className='footer-sections'>
            {/* Connectivity Section */}
            <div className='footer-section'>
              <h3>Connection</h3>
              <div className='footer-section-content'>
                <div className='connectivity-status'>
                  <span
                    className='status-indicator'
                    style={{ color: statusColor }}
                    aria-hidden='true'
                  >
                    {statusIcon}
                  </span>
                  <span className='status-text'>{statusText}</span>
                </div>

                <div className='connectivity-info'>
                  <div className='footer-info-item'>
                    <span className='footer-info-label'>Last checked:</span>
                    <span className='footer-info-value'>{formatTime(lastChecked)}</span>
                  </div>

                  {lastSuccessful && (
                    <div className='footer-info-item'>
                      <span className='footer-info-label'>Last successful:</span>
                      <span className='footer-info-value'>{formatTime(lastSuccessful)}</span>
                    </div>
                  )}

                  {error && (
                    <div className='footer-info-item error'>
                      <span className='footer-info-label'>Error:</span>
                      <span className='footer-info-value'>{error}</span>
                    </div>
                  )}

                  {retryCount > 0 && (
                    <div className='footer-info-item'>
                      <span className='footer-info-label'>Retry attempts:</span>
                      <span className='footer-info-value'>{retryCount}</span>
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

            {/* App Information Section */}
            <div className='footer-section'>
              <h3>App Info</h3>
              <div className='footer-section-content'>
                <div className='footer-info-item'>
                  <span className='footer-info-label'>Version:</span>
                  <span className='footer-info-value'>{appVersion}</span>
                </div>
                <div className='footer-info-item'>
                  <span className='footer-info-label'>Build:</span>
                  <span className='footer-info-value'>{buildDate}</span>
                </div>
                <div className='footer-info-item'>
                  <span className='footer-info-label'>Environment:</span>
                  <span className='footer-info-value'>{getEnvironment()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Additional Custom Sections */}
          {additionalSections.length > 0 && (
            <div className='footer-sections'>
              {additionalSections.map(section => (
                <div key={section.id} className='footer-section'>
                  <h3>{section.title}</h3>
                  <div className='footer-section-content'>{section.content}</div>
                </div>
              ))}
            </div>
          )}

          {/* Footer Links */}
          <div className='footer-links'>
            {customLinks.length > 0 ? (
              customLinks.map((link, index) => (
                <a
                  key={index}
                  href={link.href}
                  className='footer-link'
                  onClick={link.onClick || (e => e.preventDefault())}
                >
                  {link.label}
                </a>
              ))
            ) : (
              <>
                <button type='button' className='footer-link' onClick={() => {}}>
                  Privacy Policy
                </button>
                <button type='button' className='footer-link' onClick={() => {}}>
                  Terms of Service
                </button>
                <button type='button' className='footer-link' onClick={() => {}}>
                  Help & Support
                </button>
                <button type='button' className='footer-link' onClick={() => {}}>
                  About
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
