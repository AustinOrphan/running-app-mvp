import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StatsCard } from '../../../../src/components/Analytics/StatsCard';

// Mock InteractiveCard component
vi.mock('../../../../src/components/Interactive/InteractiveCard', () => ({
  InteractiveCard: ({ children, className, style, onClick, ...props }: any) => (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      data-testid='interactive-card'
      className={className}
      style={style}
      onClick={onClick}
      data-interactive={props.interactive}
      data-elevation={props.elevation}
      data-tilt={props.tilt}
    >
      {children}
    </div>
  ),
}));

describe('StatsCard', () => {
  const defaultProps = {
    icon: '🏃',
    label: 'Total Runs',
    value: 25,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders icon, label, and value', () => {
      render(<StatsCard {...defaultProps} />);

      expect(screen.getByText('🏃')).toBeInTheDocument();
      expect(screen.getByText('Total Runs')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
    });

    it('renders with string value', () => {
      render(<StatsCard {...defaultProps} value='10.5 km' />);

      expect(screen.getByText('10.5 km')).toBeInTheDocument();
    });

    it('renders with numeric value', () => {
      render(<StatsCard {...defaultProps} value={42} />);

      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  describe('SubValue and Trends', () => {
    it('renders subValue when provided', () => {
      render(<StatsCard {...defaultProps} subValue='+5 from last week' />);

      expect(screen.getByText(/\+5 from last week/)).toBeInTheDocument();
    });

    it('does not render subValue when not provided', () => {
      const { container } = render(<StatsCard {...defaultProps} />);

      expect(container.querySelector('.stats-card-subvalue')).not.toBeInTheDocument();
    });

    it('renders up trend with correct icon', () => {
      render(<StatsCard {...defaultProps} subValue='+10%' trend='up' />);

      const subValue = screen.getByText(/\+10%/);
      expect(subValue.textContent).toContain('↗');
    });

    it('renders down trend with correct icon', () => {
      render(<StatsCard {...defaultProps} subValue='-5%' trend='down' />);

      const subValue = screen.getByText(/-5%/);
      expect(subValue.textContent).toContain('↘');
    });

    it('renders neutral trend without icon', () => {
      render(<StatsCard {...defaultProps} subValue='Same as last week' trend='neutral' />);

      const subValue = screen.getByText(/Same as last week/);
      expect(subValue.textContent).not.toContain('↗');
      expect(subValue.textContent).not.toContain('↘');
    });

    it('applies success color to up trend', () => {
      render(<StatsCard {...defaultProps} subValue='+10%' trend='up' />);

      const subValue = screen.getByText(/\+10%/);
      expect(subValue).toHaveStyle({ color: 'var(--color-success)' });
    });

    it('applies warning color to down trend', () => {
      render(<StatsCard {...defaultProps} subValue='-5%' trend='down' />);

      const subValue = screen.getByText(/-5%/);
      expect(subValue).toHaveStyle({ color: 'var(--color-warning)' });
    });

    it('applies secondary color to neutral trend', () => {
      render(<StatsCard {...defaultProps} subValue='Same' trend='neutral' />);

      const subValue = screen.getByText(/Same/);
      expect(subValue).toHaveStyle({ color: 'var(--color-text-secondary)' });
    });
  });

  describe('Loading State', () => {
    it('renders loading skeleton when loading is true', () => {
      const { container } = render(<StatsCard {...defaultProps} loading={true} />);

      expect(container.querySelector('.stats-card-loading')).toBeInTheDocument();
      expect(container.querySelectorAll('.skeleton-line')).toHaveLength(3);
    });

    it('does not render content when loading', () => {
      render(<StatsCard {...defaultProps} loading={true} />);

      expect(screen.queryByText('🏃')).not.toBeInTheDocument();
      expect(screen.queryByText('Total Runs')).not.toBeInTheDocument();
      expect(screen.queryByText('25')).not.toBeInTheDocument();
    });

    it('renders content when loading is false', () => {
      render(<StatsCard {...defaultProps} loading={false} />);

      expect(screen.getByText('🏃')).toBeInTheDocument();
      expect(screen.getByText('Total Runs')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
    });
  });

  describe('Color Customization', () => {
    it('applies default color when not specified', () => {
      const { container } = render(<StatsCard {...defaultProps} />);

      const card = container.querySelector('.stats-card');
      expect(card).toHaveStyle({ '--accent-color': 'var(--color-primary)' });
    });

    it('applies custom color when specified', () => {
      const { container } = render(<StatsCard {...defaultProps} color='#ff5733' />);

      const card = container.querySelector('.stats-card');
      expect(card).toHaveStyle({ '--accent-color': '#ff5733' });
    });
  });

  describe('Interactivity', () => {
    it('calls onClick when clicked', async () => {
      const mockOnClick = vi.fn();
      const user = userEvent.setup();

      render(<StatsCard {...defaultProps} onClick={mockOnClick} />);

      const card = screen.getByTestId('interactive-card');
      await user.click(card);

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it('sets interactive prop when onClick is provided', () => {
      const mockOnClick = vi.fn();
      render(<StatsCard {...defaultProps} onClick={mockOnClick} />);

      const card = screen.getByTestId('interactive-card');
      expect(card).toHaveAttribute('data-interactive', 'true');
    });

    it('sets interactive prop to false when onClick is not provided', () => {
      render(<StatsCard {...defaultProps} />);

      const card = screen.getByTestId('interactive-card');
      expect(card).toHaveAttribute('data-interactive', 'false');
    });

    it('does not render InteractiveCard when loading', () => {
      const mockOnClick = vi.fn();

      const { container } = render(
        <StatsCard {...defaultProps} loading={true} onClick={mockOnClick} />
      );

      const loadingCard = container.querySelector('.stats-card-loading');
      expect(loadingCard).toBeInTheDocument();

      // InteractiveCard should not be rendered in loading state
      expect(screen.queryByTestId('interactive-card')).not.toBeInTheDocument();
    });
  });

  describe('InteractiveCard Props', () => {
    it('passes elevation prop to InteractiveCard', () => {
      render(<StatsCard {...defaultProps} />);

      const card = screen.getByTestId('interactive-card');
      expect(card).toHaveAttribute('data-elevation', '1');
    });

    it('passes tilt prop to InteractiveCard', () => {
      render(<StatsCard {...defaultProps} />);

      const card = screen.getByTestId('interactive-card');
      expect(card).toHaveAttribute('data-tilt', 'true');
    });

    it('applies stats-card className to InteractiveCard', () => {
      render(<StatsCard {...defaultProps} />);

      const card = screen.getByTestId('interactive-card');
      expect(card).toHaveClass('stats-card');
    });
  });

  describe('Edge Cases', () => {
    it('handles zero value', () => {
      render(<StatsCard {...defaultProps} value={0} />);

      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('handles empty string value', () => {
      render(<StatsCard {...defaultProps} value='' />);

      expect(screen.getByText('Total Runs')).toBeInTheDocument();
    });

    it('handles very long labels', () => {
      render(
        <StatsCard {...defaultProps} label='This is a very long label that might need to wrap' />
      );

      expect(
        screen.getByText('This is a very long label that might need to wrap')
      ).toBeInTheDocument();
    });

    it('handles very large numeric values', () => {
      render(<StatsCard {...defaultProps} value={999999999} />);

      expect(screen.getByText('999999999')).toBeInTheDocument();
    });

    it('handles special characters in label', () => {
      render(<StatsCard {...defaultProps} label='Distance (km/mi)' />);

      expect(screen.getByText('Distance (km/mi)')).toBeInTheDocument();
    });
  });
});
