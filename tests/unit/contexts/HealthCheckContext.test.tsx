import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { HealthCheckProvider, useHealthCheck } from '../../../src/contexts/HealthCheckContext';
import * as connectivityModule from '../../../src/hooks/useConnectivityStatus';
import type { ConnectivityStatus } from '../../../src/hooks/useConnectivityStatus';

// Mock the useConnectivityStatus hook
vi.mock('../../../src/hooks/useConnectivityStatus', () => ({
  useConnectivityStatus: vi.fn(),
  ConnectivityStatus: {
    healthy: 'healthy',
    connecting: 'connecting',
    disconnected: 'disconnected',
    loading: 'loading',
  },
}));

// Test component that uses the health check context
const TestComponent: React.FC = () => {
  const { status, healthStatus, lastChecked, retry } = useHealthCheck();

  return (
    <div>
      <div data-testid='status'>{status}</div>
      <div data-testid='health-status'>{healthStatus}</div>
      <div data-testid='last-checked'>{lastChecked?.toISOString() || 'never'}</div>
      <button onClick={() => retry()} data-testid='retry-button'>
        Retry
      </button>
    </div>
  );
};

describe('HealthCheckContext', () => {
  const mockUseConnectivityStatus = vi.mocked(connectivityModule.useConnectivityStatus);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('provides health check context to children', async () => {
    const mockDate = new Date('2023-01-01T12:00:00Z');
    const mockRetry = vi.fn();
    const mockCheckHealth = vi.fn();

    mockUseConnectivityStatus.mockReturnValue({
      status: 'healthy',
      lastChecked: mockDate,
      lastSuccessful: mockDate,
      retryCount: 0,
      error: undefined,
      retry: mockRetry,
      checkHealth: mockCheckHealth,
    });

    render(
      <HealthCheckProvider>
        <TestComponent />
      </HealthCheckProvider>
    );

    expect(screen.getByTestId('status')).toHaveTextContent('healthy');
    expect(screen.getByTestId('health-status')).toHaveTextContent('✅ Backend Connected');
    expect(screen.getByTestId('last-checked')).toHaveTextContent('2023-01-01T12:00:00.000Z');
  });

  it('converts connectivity status to legacy health status format', () => {
    const testCases: { status: ConnectivityStatus; expected: string }[] = [
      { status: 'healthy', expected: '✅ Backend Connected' },
      { status: 'connecting', expected: '🔄 Connecting...' },
      { status: 'disconnected', expected: '❌ Backend Offline' },
      { status: 'loading', expected: 'Checking...' },
    ];

    testCases.forEach(({ status, expected }) => {
      mockUseConnectivityStatus.mockReturnValue({
        status,
        lastChecked: null,
        lastSuccessful: null,
        retryCount: 0,
        error: undefined,
        retry: vi.fn(),
        checkHealth: vi.fn(),
      });

      const { unmount } = render(
        <HealthCheckProvider>
          <TestComponent />
        </HealthCheckProvider>
      );

      expect(screen.getByTestId('health-status')).toHaveTextContent(expected);
      unmount();
    });
  });

  it('passes through retry function', async () => {
    const mockRetry = vi.fn();
    mockUseConnectivityStatus.mockReturnValue({
      status: 'disconnected',
      lastChecked: new Date(),
      lastSuccessful: null,
      retryCount: 1,
      error: 'Connection failed',
      retry: mockRetry,
      checkHealth: vi.fn(),
    });

    render(
      <HealthCheckProvider>
        <TestComponent />
      </HealthCheckProvider>
    );

    const retryButton = screen.getByTestId('retry-button');
    retryButton.click();

    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('throws error when useHealthCheck is used outside provider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useHealthCheck must be used within a HealthCheckProvider');

    consoleSpy.mockRestore();
  });

  it('handles error state correctly', () => {
    const mockError = 'Network connection failed';
    mockUseConnectivityStatus.mockReturnValue({
      status: 'disconnected',
      lastChecked: new Date(),
      lastSuccessful: null,
      retryCount: 2,
      error: mockError,
      retry: vi.fn(),
      checkHealth: vi.fn(),
    });

    render(
      <HealthCheckProvider>
        <TestComponent />
      </HealthCheckProvider>
    );

    expect(screen.getByTestId('status')).toHaveTextContent('disconnected');
    expect(screen.getByTestId('health-status')).toHaveTextContent('❌ Backend Offline');
  });
});
