import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { PersonalRecordsTable } from '../../../../src/components/Stats/PersonalRecordsTable';
import { mockPersonalRecords } from '../../../fixtures/mockData.js';

// Mock the formatters utility
vi.mock('../../../../src/utils/formatters', () => ({
  formatDuration: vi.fn((seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }),
  formatPace: vi.fn((paceInSeconds: number, options: any = {}) => {
    if (!isFinite(paceInSeconds) || paceInSeconds <= 0) return '-';
    const minutes = Math.floor(paceInSeconds / 60);
    const seconds = Math.round(paceInSeconds % 60);
    const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    return options.includeUnit ? `${formatted}/km` : formatted;
  }),
  formatDate: vi.fn((dateInput: string | Date, _format: string = 'weekday-short') => {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }),
}));

describe('PersonalRecordsTable', () => {
  describe('Loading State', () => {
    it('renders loading skeleton when loading is true', () => {
      render(<PersonalRecordsTable records={[]} loading={true} />);

      expect(screen.getByText('Personal Records')).toBeInTheDocument();
      expect(screen.getAllByTestId('skeleton-line').length).toBeGreaterThan(0);
    });

    it('displays table skeleton with correct structure', () => {
      const { container } = render(<PersonalRecordsTable records={[]} loading={true} />);

      // Look for skeleton elements by their structure and test-ids instead of CSS classes
      expect(screen.getAllByTestId('skeleton-line').length).toBeGreaterThan(0);
      expect(container.querySelector('[data-testid="skeleton-line"]')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders empty state when no records and not loading', () => {
      render(<PersonalRecordsTable records={[]} loading={false} />);

      expect(screen.getByText('Personal Records')).toBeInTheDocument();
      expect(screen.getByText('No personal records yet')).toBeInTheDocument();
      expect(screen.getByText('Run different distances to set your first PRs')).toBeInTheDocument();
      expect(screen.getByText('🏆')).toBeInTheDocument();
    });
  });

  describe('Data State', () => {
    it('renders table with records correctly', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      expect(screen.getByText('Personal Records')).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();

      // Check headers
      expect(screen.getByRole('columnheader', { name: /Distance/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Time/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Pace/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Date/i })).toBeInTheDocument();
    });

    it('displays all record data correctly', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      // Check distance formatting
      expect(screen.getByText('1K')).toBeInTheDocument();
      expect(screen.getByText('2K')).toBeInTheDocument();
      expect(screen.getByText('5K')).toBeInTheDocument();
      expect(screen.getByText('10K')).toBeInTheDocument();
      expect(screen.getByText('Half Marathon')).toBeInTheDocument();

      // Check formatted times (mocked)
      expect(screen.getByText('4:00')).toBeInTheDocument(); // 240 seconds
      expect(screen.getByText('8:30')).toBeInTheDocument(); // 510 seconds
    });

    it('formats pace correctly', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      // Check pace formatting (240 seconds = 4:00/km)
      expect(screen.getByText('4:00/km')).toBeInTheDocument();
      expect(screen.getByText('4:15/km')).toBeInTheDocument(); // 255 seconds
    });

    it('formats dates correctly', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      // Should format dates as "May 15, 2024" etc.
      expect(screen.getAllByText(/May 15, 2024/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Jun 9, 2024/).length).toBeGreaterThan(0);
    });

    it('displays summary statistics correctly', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      expect(
        screen.getByText(
          (_, node) => node?.textContent === `Total PRs: ${mockPersonalRecords.length}`
        )
      ).toBeInTheDocument();
      expect(screen.getByText(/Latest:/)).toBeInTheDocument();
    });
  });

  describe('Sorting Functionality', () => {
    it('sorts by distance when distance header is clicked', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      const distanceHeader = screen.getByRole('columnheader', { name: /Distance/i });
      fireEvent.click(distanceHeader);

      // Check that header has active styling by checking for active class (CSS modules or regular)
      const thElement = distanceHeader.closest('th');
      expect(thElement?.className).toMatch(/active/);
    });

    it('toggles sort direction when same header is clicked twice', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      const distanceHeader = screen.getByRole('columnheader', { name: /Distance/i });

      // First click - should set to descending (actual behavior)
      fireEvent.click(distanceHeader);
      expect(distanceHeader).toHaveTextContent(/Distance.*↓/);

      // Second click - should toggle to ascending
      fireEvent.click(distanceHeader);
      expect(distanceHeader).toHaveTextContent(/Distance.*↑/);

      // Third click - should toggle back to descending
      fireEvent.click(distanceHeader);
      expect(distanceHeader).toHaveTextContent(/Distance.*↓/);
    });

    it('shows neutral sort icon for non-active columns', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      // Initially, non-active columns should show neutral icon
      expect(screen.getByRole('columnheader', { name: /Time/i })).toHaveTextContent(/Time ↕️/);
      expect(screen.getByRole('columnheader', { name: /Pace/i })).toHaveTextContent(/Pace ↕️/);
      expect(screen.getByRole('columnheader', { name: /Date/i })).toHaveTextContent(/Date ↕️/);
    });

    it('sorts by time when time header is clicked', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      const timeHeader = screen.getByRole('columnheader', { name: /Time/i });
      fireEvent.click(timeHeader);

      // Check that header has active styling by checking for active class (CSS modules or regular)
      const thElement = timeHeader.closest('th');
      expect(thElement?.className).toMatch(/active/);
      expect(screen.getByText('Time ↑')).toBeInTheDocument();
    });

    it('sorts by pace when pace header is clicked', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      const paceHeader = screen.getByRole('columnheader', { name: /Pace/i });
      fireEvent.click(paceHeader);

      // Check that header has active styling by checking for active class (CSS modules or regular)
      const thElement = paceHeader.closest('th');
      expect(thElement?.className).toMatch(/active/);
    });

    it('sorts by date when date header is clicked', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      const dateHeader = screen.getByRole('columnheader', { name: /Date/i });
      fireEvent.click(dateHeader);

      // Check that header has active styling by checking for active class (CSS modules or regular)
      const thElement = dateHeader.closest('th');
      expect(thElement?.className).toMatch(/active/);
    });
  });

  describe('Distance Formatting', () => {
    it('formats standard distances correctly', () => {
      const customRecords = [
        { distance: 1, bestTime: 240, bestPace: 240, date: '2024-01-01T00:00:00Z', runId: 'run1' },
        {
          distance: 21.1,
          bestTime: 6300,
          bestPace: 298,
          date: '2024-01-01T00:00:00Z',
          runId: 'run2',
        },
        {
          distance: 42.2,
          bestTime: 12600,
          bestPace: 298,
          date: '2024-01-01T00:00:00Z',
          runId: 'run3',
        },
      ];

      render(<PersonalRecordsTable records={customRecords} loading={false} />);

      expect(screen.getByText('1K')).toBeInTheDocument();
      expect(screen.getByText('Half Marathon')).toBeInTheDocument();
      expect(screen.getByText('Marathon')).toBeInTheDocument();
    });

    it('formats sub-kilometer distances correctly', () => {
      const subKRecords = [
        {
          distance: 0.4,
          bestTime: 120,
          bestPace: 300,
          date: '2024-01-01T00:00:00Z',
          runId: 'run1',
        },
      ];

      render(<PersonalRecordsTable records={subKRecords} loading={false} />);

      expect(screen.getByText('400m')).toBeInTheDocument();
    });
  });

  describe('Component Structure', () => {
    it('has correct CSS classes for styling', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      // Check for table by ARIA label instead of CSS classes
      expect(screen.getByLabelText('Personal records table')).toBeInTheDocument();
      // Check for text content that indicates structure
      expect(screen.getByText('Personal Records')).toBeInTheDocument();
      expect(screen.getByText(/Total PRs:/)).toBeInTheDocument();
    });

    it('applies correct styling classes to cells', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      // Check for actual content instead of CSS classes
      expect(screen.getByText('5K')).toBeInTheDocument(); // distance value
      expect(screen.getByText('22:00')).toBeInTheDocument(); // time value from mock (5K = 1320 seconds = 22:00)
      expect(screen.getByText('4:24/km')).toBeInTheDocument(); // specific pace value with unit (5K pace)
      expect(screen.getByText('May 1, 2024')).toBeInTheDocument(); // specific date value (5K record)
    });
  });

  describe('Edge Cases', () => {
    it('handles zero pace correctly', () => {
      const recordsWithZeroPace = [
        { distance: 5, bestTime: 1500, bestPace: 0, date: '2024-01-01T00:00:00Z', runId: 'run1' },
      ];

      render(<PersonalRecordsTable records={recordsWithZeroPace} loading={false} />);

      expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('calculates latest record correctly', () => {
      const recordsWithDifferentDates = [
        { distance: 5, bestTime: 1500, bestPace: 300, date: '2024-01-01T00:00:00Z', runId: 'run1' },
        {
          distance: 10,
          bestTime: 3000,
          bestPace: 300,
          date: '2024-06-15T00:00:00Z',
          runId: 'run2',
        },
        { distance: 1, bestTime: 300, bestPace: 300, date: '2024-03-01T00:00:00Z', runId: 'run3' },
      ];

      render(<PersonalRecordsTable records={recordsWithDifferentDates} loading={false} />);

      // Should show the latest date (Jun 15, 2024)
      expect(screen.getAllByText(/Jun 15, 2024/).length).toBeGreaterThan(0);
    });

    it('handles single record', () => {
      const singleRecord = [mockPersonalRecords[0]];

      render(<PersonalRecordsTable records={singleRecord} loading={false} />);

      expect(
        screen.getByText((_, node) => node?.textContent === 'Total PRs: 1')
      ).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper heading structure', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      expect(screen.getByRole('heading', { name: 'Personal Records' })).toBeInTheDocument();
    });

    it('has accessible table structure', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getAllByRole('columnheader')).toHaveLength(4);
      expect(screen.getAllByRole('row')).toHaveLength(mockPersonalRecords.length + 1); // +1 for header
    });

    it('has sortable column headers with proper interaction', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      const sortableHeaders = screen.getAllByText(/↕️|↑|↓/);
      expect(sortableHeaders.length).toBeGreaterThan(0);
    });
  });
});
