import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { PersonalRecordsTable } from '../../../../src/components/Stats/PersonalRecordsTable';
import { mockPersonalRecords } from '../../../fixtures/mockData';

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

      expect(container.querySelector('.table-skeleton')).toBeInTheDocument();
      expect(container.querySelector('.header-skeleton')).toBeInTheDocument();
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

      // Check that header has active class
      expect(distanceHeader.closest('th')).toHaveClass('active');
    });

    it('toggles sort direction when same header is clicked twice', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      const distanceHeader = screen.getByRole('columnheader', { name: /Distance/i });

      // Initial state should be ascending
      expect(screen.getByText('Distance ↑')).toBeInTheDocument();

      // First click - descending
      fireEvent.click(distanceHeader);
      expect(screen.getByText('Distance ↓')).toBeInTheDocument();

      // Second click - back to ascending
      fireEvent.click(distanceHeader);
      expect(screen.getByText('Distance ↑')).toBeInTheDocument();
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

      expect(timeHeader.closest('th')).toHaveClass('active');
      expect(screen.getByText('Time ↑')).toBeInTheDocument();
    });

    it('sorts by pace when pace header is clicked', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      const paceHeader = screen.getByRole('columnheader', { name: /Pace/i });
      fireEvent.click(paceHeader);

      expect(paceHeader.closest('th')).toHaveClass('active');
    });

    it('sorts by date when date header is clicked', () => {
      render(<PersonalRecordsTable records={mockPersonalRecords} loading={false} />);

      const dateHeader = screen.getByRole('columnheader', { name: /Date/i });
      fireEvent.click(dateHeader);

      expect(dateHeader.closest('th')).toHaveClass('active');
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
      const { container } = render(
        <PersonalRecordsTable records={mockPersonalRecords} loading={false} />
      );

      expect(container.querySelector('.records-table-card')).toBeInTheDocument();
      expect(container.querySelector('.records-table-container')).toBeInTheDocument();
      expect(container.querySelector('.records-table')).toBeInTheDocument();
      expect(container.querySelector('.records-summary')).toBeInTheDocument();
    });

    it('applies correct styling classes to cells', () => {
      const { container } = render(
        <PersonalRecordsTable records={mockPersonalRecords} loading={false} />
      );

      expect(container.querySelector('.distance-value')).toBeInTheDocument();
      expect(container.querySelector('.time-value')).toBeInTheDocument();
      expect(container.querySelector('.pace-value')).toBeInTheDocument();
      expect(container.querySelector('.date-value')).toBeInTheDocument();
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
