import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConnectivityFooter } from '../../../src/components/Connectivity/ConnectivityFooter';

// Mock dependencies with stable implementations
vi.mock('../../../src/contexts/HealthCheckContext', () => ({
  useHealthCheck: () => ({
    status: 'healthy',
    lastChecked: new Date('2024-01-01T12:00:00.000Z'),
    lastSuccessful: new Date('2024-01-01T12:00:00.000Z'),
    retryCount: 0,
    error: undefined,
    retry: vi.fn(),
    checkHealth: vi.fn(),
    healthStatus: '✅ Backend Connected',
  }),
}));

vi.mock('../../../src/utils/env', () => ({
  getAppVersion: () => '1.0.0',
  getBuildDate: () => '2024-01-01T00:00:00.000Z',
  getEnvironment: () => 'test',
}));

describe('ConnectivityFooter - Basic Tests', () => {
  it('renders basic structure', () => {
    render(<ConnectivityFooter />);

    expect(screen.getByRole('button', { name: /Footer: Connected/ })).toBeInTheDocument();
  });

  it('displays status information', () => {
    render(<ConnectivityFooter />);

    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('displays app information', () => {
    render(<ConnectivityFooter />);

    expect(screen.getByText('App Info')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
  });

  it('responds to status line clicks', () => {
    render(<ConnectivityFooter />);

    const statusLine = screen.getByRole('button', { name: /Footer: Connected/ });

    // Should not throw error when clicked
    expect(() => fireEvent.click(statusLine)).not.toThrow();

    // Footer should have expanded class after click
    expect(document.querySelector('.connectivity-footer')).toHaveClass('expanded');
  });

  it('applies custom className', () => {
    render(<ConnectivityFooter className='test-class' />);

    expect(document.querySelector('.connectivity-footer')).toHaveClass('test-class');
  });
});
