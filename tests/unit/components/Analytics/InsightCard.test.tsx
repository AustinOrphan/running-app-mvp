import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { InsightCard } from '../../../../src/components/Analytics/InsightCard';
import { Insight } from '../../../../src/types';

describe('InsightCard', () => {
  const baseInsight: Insight = {
    type: 'consistency',
    priority: 'high',
    message: 'Great consistency! You ran 5 times this week.',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders insight message', () => {
      render(<InsightCard insight={baseInsight} />);

      expect(screen.getByText('Great consistency! You ran 5 times this week.')).toBeInTheDocument();
    });

    it('renders insight type label', () => {
      render(<InsightCard insight={baseInsight} />);

      expect(screen.getByText('Consistency')).toBeInTheDocument();
    });

    it('renders priority label', () => {
      render(<InsightCard insight={baseInsight} />);

      expect(screen.getByText('High Priority')).toBeInTheDocument();
    });
  });

  describe('Insight Types', () => {
    const testCases: Array<{ type: Insight['type']; icon: string; label: string }> = [
      { type: 'consistency', icon: '🎯', label: 'Consistency' },
      { type: 'volume', icon: '📊', label: 'Volume' },
      { type: 'recovery', icon: '😴', label: 'Recovery' },
      { type: 'performance', icon: '🚀', label: 'Performance' },
      { type: 'goal', icon: '🏆', label: 'Goal' },
    ];

    testCases.forEach(({ type, icon, label }) => {
      it(`renders ${type} insight with correct icon and label`, () => {
        const insight: Insight = {
          ...baseInsight,
          type,
        };

        render(<InsightCard insight={insight} />);

        expect(screen.getByText(icon)).toBeInTheDocument();
        expect(screen.getByText(label)).toBeInTheDocument();
      });
    });
  });

  describe('Priority Levels', () => {
    const priorities: Array<{
      priority: Insight['priority'];
      label: string;
      color: string;
    }> = [
      { priority: 'high', label: 'High Priority', color: 'var(--color-danger, #ef4444)' },
      { priority: 'medium', label: 'Medium Priority', color: 'var(--color-warning, #f59e0b)' },
      { priority: 'low', label: 'Low Priority', color: 'var(--color-info, #3b82f6)' },
    ];

    priorities.forEach(({ priority, label, color }) => {
      it(`renders ${priority} priority with correct label`, () => {
        const insight: Insight = {
          ...baseInsight,
          priority,
        };

        render(<InsightCard insight={insight} />);

        expect(screen.getByText(label)).toBeInTheDocument();
      });

      it(`applies correct color for ${priority} priority`, () => {
        const insight: Insight = {
          ...baseInsight,
          priority,
        };

        const { container } = render(<InsightCard insight={insight} />);
        const card = container.querySelector('.insight-card');

        expect(card).toHaveStyle({ '--priority-color': color });
      });
    });
  });

  describe('Actionable Insights', () => {
    it('renders actionable text when provided', () => {
      const insight: Insight = {
        ...baseInsight,
        actionable: 'Keep up the momentum and aim for 6 runs next week',
      };

      render(<InsightCard insight={insight} />);

      expect(
        screen.getByText('Keep up the momentum and aim for 6 runs next week')
      ).toBeInTheDocument();
    });

    it('renders action icon when actionable is provided', () => {
      const insight: Insight = {
        ...baseInsight,
        actionable: 'Try to increase your weekly mileage',
      };

      const { container } = render(<InsightCard insight={insight} />);
      const actionIcon = container.querySelector('.action-icon');

      expect(actionIcon).toBeInTheDocument();
      expect(actionIcon?.textContent).toBe('💡');
    });

    it('does not render action section when actionable is not provided', () => {
      const insight: Insight = {
        ...baseInsight,
        actionable: undefined,
      };

      const { container } = render(<InsightCard insight={insight} />);

      expect(container.querySelector('.insight-action')).not.toBeInTheDocument();
    });

    it('renders both message and actionable text', () => {
      const insight: Insight = {
        ...baseInsight,
        message: 'Your pace improved by 10 seconds per mile',
        actionable: 'Maintain this pace for longer runs',
      };

      render(<InsightCard insight={insight} />);

      expect(screen.getByText('Your pace improved by 10 seconds per mile')).toBeInTheDocument();
      expect(screen.getByText('Maintain this pace for longer runs')).toBeInTheDocument();
    });
  });

  describe('Dismiss Functionality', () => {
    it('renders dismiss button when onDismiss is provided', () => {
      const mockOnDismiss = vi.fn();
      render(<InsightCard insight={baseInsight} onDismiss={mockOnDismiss} />);

      expect(screen.getByRole('button', { name: 'Dismiss insight' })).toBeInTheDocument();
    });

    it('does not render dismiss button when onDismiss is not provided', () => {
      render(<InsightCard insight={baseInsight} />);

      expect(screen.queryByRole('button', { name: 'Dismiss insight' })).not.toBeInTheDocument();
    });

    it('calls onDismiss with correct insight when dismiss button is clicked', async () => {
      const mockOnDismiss = vi.fn();
      const user = userEvent.setup();

      render(<InsightCard insight={baseInsight} onDismiss={mockOnDismiss} />);

      const dismissButton = screen.getByRole('button', { name: 'Dismiss insight' });
      await user.click(dismissButton);

      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
      expect(mockOnDismiss).toHaveBeenCalledWith(baseInsight);
    });

    it('dismiss button has correct title attribute', () => {
      const mockOnDismiss = vi.fn();
      render(<InsightCard insight={baseInsight} onDismiss={mockOnDismiss} />);

      const dismissButton = screen.getByRole('button', { name: 'Dismiss insight' });
      expect(dismissButton).toHaveAttribute('title', 'Dismiss');
    });
  });

  describe('Complex Scenarios', () => {
    it('renders high priority consistency insight with actionable', () => {
      const insight: Insight = {
        type: 'consistency',
        priority: 'high',
        message: 'Great consistency! You ran 5 times this week.',
        actionable: 'Keep up the momentum and aim for 6 runs next week',
      };

      render(<InsightCard insight={insight} onDismiss={vi.fn()} />);

      expect(screen.getByText('🎯')).toBeInTheDocument();
      expect(screen.getByText('Consistency')).toBeInTheDocument();
      expect(screen.getByText('High Priority')).toBeInTheDocument();
      expect(screen.getByText('Great consistency! You ran 5 times this week.')).toBeInTheDocument();
      expect(
        screen.getByText('Keep up the momentum and aim for 6 runs next week')
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dismiss insight' })).toBeInTheDocument();
    });

    it('renders medium priority recovery insight without actionable', () => {
      const insight: Insight = {
        type: 'recovery',
        priority: 'medium',
        message: 'You might need more recovery time',
      };

      render(<InsightCard insight={insight} />);

      expect(screen.getByText('😴')).toBeInTheDocument();
      expect(screen.getByText('Recovery')).toBeInTheDocument();
      expect(screen.getByText('Medium Priority')).toBeInTheDocument();
      expect(screen.getByText('You might need more recovery time')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Dismiss insight' })).not.toBeInTheDocument();
    });

    it('renders low priority performance insight', () => {
      const insight: Insight = {
        type: 'performance',
        priority: 'low',
        message: 'Average pace improved by 10 seconds per mile',
        actionable: 'Consider increasing intensity gradually',
      };

      const { container } = render(<InsightCard insight={insight} />);

      expect(screen.getByText('🚀')).toBeInTheDocument();
      expect(screen.getByText('Performance')).toBeInTheDocument();
      expect(screen.getByText('Low Priority')).toBeInTheDocument();

      const card = container.querySelector('.insight-card');
      expect(card).toHaveStyle({ '--priority-color': 'var(--color-info, #3b82f6)' });
    });
  });

  describe('Edge Cases', () => {
    it('handles very long message text', () => {
      const insight: Insight = {
        ...baseInsight,
        message:
          'This is a very long message that contains a lot of information about your running performance and should wrap to multiple lines properly without breaking the layout of the card component.',
      };

      render(<InsightCard insight={insight} />);

      expect(
        screen.getByText(/This is a very long message that contains a lot of information/)
      ).toBeInTheDocument();
    });

    it('handles very long actionable text', () => {
      const insight: Insight = {
        ...baseInsight,
        actionable:
          'This is a very detailed action recommendation that provides specific steps and guidance for improving your running performance over the next several weeks.',
      };

      render(<InsightCard insight={insight} />);

      expect(
        screen.getByText(/This is a very detailed action recommendation that provides specific/)
      ).toBeInTheDocument();
    });

    it('handles empty message', () => {
      const insight: Insight = {
        ...baseInsight,
        message: '',
      };

      const { container } = render(<InsightCard insight={insight} />);

      const messageElement = container.querySelector('.insight-message');
      expect(messageElement).toBeInTheDocument();
      expect(messageElement?.textContent).toBe('');
    });

    it('handles special characters in message', () => {
      const insight: Insight = {
        ...baseInsight,
        message: 'Great work! Your pace improved by 15% & distance increased by 10km.',
      };

      render(<InsightCard insight={insight} />);

      expect(
        screen.getByText('Great work! Your pace improved by 15% & distance increased by 10km.')
      ).toBeInTheDocument();
    });
  });
});
