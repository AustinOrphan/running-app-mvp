import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { GoalCard } from '../../../src/components/GoalCard';
import {
  mockGoals,
  mockGoalProgress,
  createMockGoal,
  createMockGoalProgress,
} from '../../fixtures/mockData';

// Mock the visualization components
vi.mock('../../../src/components/Goals/CircularProgress', () => ({
  CircularProgress: ({ children, percentage }: any) => (
    <div data-testid='circular-progress' data-percentage={percentage}>
      {children}
    </div>
  ),
}));

vi.mock('../../../src/components/Goals/GoalProgressChart', () => ({
  GoalProgressChart: ({ goal, progress }: any) => (
    <div
      data-testid='goal-progress-chart'
      data-goal-id={goal.id}
      data-progress={JSON.stringify(progress)}
    >
      Progress Chart for {goal.title}
    </div>
  ),
}));

describe('GoalCard', () => {
  const mockOnComplete = vi.fn();
  const mockOnDelete = vi.fn();
  const mockOnEdit = vi.fn();

  const defaultProps = {
    goal: mockGoals[0],
    onComplete: mockOnComplete,
    onDelete: mockOnDelete,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders goal title and type', () => {
      render(<GoalCard {...defaultProps} />);

      expect(screen.getByText(mockGoals[0].title)).toBeInTheDocument();
      expect(screen.getByText('Distance Goal')).toBeInTheDocument();
    });

    it('renders goal description when provided', () => {
      const goalWithDescription = createMockGoal({
        description: 'Test goal description',
      });

      render(<GoalCard {...defaultProps} goal={goalWithDescription} />);

      expect(screen.getByText('Test goal description')).toBeInTheDocument();
    });

    it('does not render description when not provided', () => {
      const goalWithoutDescription = createMockGoal({
        description: undefined,
      });

      render(<GoalCard {...defaultProps} goal={goalWithoutDescription} />);

      expect(screen.queryByText('Test goal description')).not.toBeInTheDocument();
    });

    it('displays goal icon and color', () => {
      const goalWithCustomIcon = createMockGoal({
        icon: '🏃‍♂️',
        color: '#ff5733',
      });

      render(<GoalCard {...defaultProps} goal={goalWithCustomIcon} />);

      const iconElement = screen.getByText('🏃‍♂️');
      expect(iconElement).toBeInTheDocument();
      expect(iconElement).toHaveStyle({ color: '#ff5733' });
    });
  });

  describe('Progress Display', () => {
    it('renders simple progress view by default', () => {
      const progress = createMockGoalProgress({ progressPercentage: 65 });

      render(<GoalCard {...defaultProps} progress={progress} />);

      expect(screen.getByText('65%')).toBeInTheDocument();
      expect(screen.queryByTestId('circular-progress')).not.toBeInTheDocument();
    });

    it('renders detailed progress view when showDetailedView is true', () => {
      const progress = createMockGoalProgress({ progressPercentage: 75 });

      render(<GoalCard {...defaultProps} progress={progress} showDetailedView={true} />);

      const circularProgress = screen.getByTestId('circular-progress');
      expect(circularProgress).toBeInTheDocument();
      expect(circularProgress).toHaveAttribute('data-percentage', '75');
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(screen.getByText('complete')).toBeInTheDocument();
    });

    it('displays current and target values correctly', () => {
      const goal = createMockGoal({
        targetValue: 50,
        targetUnit: 'km',
        currentValue: 32.5,
      });
      const progress = createMockGoalProgress({
        currentValue: 32.5,
      });

      render(<GoalCard {...defaultProps} goal={goal} progress={progress} />);

      expect(screen.getByText('32.5km / 50.0km')).toBeInTheDocument();
    });

    it('formats different units correctly', () => {
      const testCases = [
        {
          unit: 'hours',
          current: 10.5,
          target: 20,
          expectedCurrent: '10.5h',
          expectedTarget: '20.0h',
        },
        {
          unit: 'minutes',
          current: 45.7,
          target: 60,
          expectedCurrent: '46min',
          expectedTarget: '60min',
        },
        {
          unit: 'runs',
          current: 8,
          target: 12,
          expectedCurrent: '8 runs',
          expectedTarget: '12 runs',
        },
      ];

      testCases.forEach(({ unit, current, target, expectedCurrent, expectedTarget }) => {
        const goal = createMockGoal({
          targetValue: target,
          targetUnit: unit,
          currentValue: current,
        });
        const progress = createMockGoalProgress({
          currentValue: current,
        });

        const { unmount } = render(<GoalCard {...defaultProps} goal={goal} progress={progress} />);

        expect(screen.getByText(`${expectedCurrent} / ${expectedTarget}`)).toBeInTheDocument();

        unmount();
      });
    });

    it('handles pace formatting correctly', () => {
      const goal = createMockGoal({
        targetValue: 300, // 5:00 min/km in seconds
        targetUnit: 'min/km',
        currentValue: 330, // 5:30 min/km in seconds
      });

      const progress = createMockGoalProgress({ currentValue: 330 });

      render(<GoalCard {...defaultProps} goal={goal} progress={progress} />);

      expect(screen.getByText('5:30 min/km / 5:00 min/km')).toBeInTheDocument();
    });
  });

  describe('Goal States', () => {
    it('displays completed goal correctly', () => {
      const completedGoal = createMockGoal({
        isCompleted: true,
        completedAt: new Date('2024-06-15T10:30:00Z'),
      });

      render(<GoalCard {...defaultProps} goal={completedGoal} />);

      expect(screen.getByText('✅ Completed')).toBeInTheDocument();
      expect(screen.getByText('🎉 Completed on 6/15/2024')).toBeInTheDocument();
      expect(screen.queryByTitle('Mark as completed')).not.toBeInTheDocument();
    });

    it('shows overdue status when applicable', () => {
      const progress = createMockGoalProgress({
        daysRemaining: -5,
      });

      render(<GoalCard {...defaultProps} progress={progress} />);

      expect(screen.getByText('⚠️ Overdue')).toBeInTheDocument();
    });

    it('shows days remaining when goal is active', () => {
      const progress = createMockGoalProgress({
        daysRemaining: 7,
      });

      render(<GoalCard {...defaultProps} progress={progress} />);

      expect(screen.getByText('⏰ 7 days left')).toBeInTheDocument();
    });

    it('shows goal period', () => {
      const weeklyGoal = createMockGoal({
        period: 'WEEKLY',
      });

      render(<GoalCard {...defaultProps} goal={weeklyGoal} />);

      expect(screen.getByText('📅 weekly')).toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('renders action buttons for active goals', () => {
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} onEdit={mockOnEdit} />);

      expect(screen.getByTitle('Edit goal')).toBeInTheDocument();
      expect(screen.getByTitle('Mark as completed')).toBeInTheDocument();
      expect(screen.getByTitle('Delete goal')).toBeInTheDocument();
    });

    it('does not render edit button when onEdit is not provided', () => {
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} />);

      expect(screen.queryByTitle('Edit goal')).not.toBeInTheDocument();
      expect(screen.getByTitle('Mark as completed')).toBeInTheDocument();
      expect(screen.getByTitle('Delete goal')).toBeInTheDocument();
    });

    it('does not render action buttons for completed goals', () => {
      const completedGoal = createMockGoal({ isCompleted: true });

      render(<GoalCard {...defaultProps} goal={completedGoal} onEdit={mockOnEdit} />);

      expect(screen.queryByTitle('Edit goal')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Mark as completed')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Delete goal')).not.toBeInTheDocument();
    });

    it('calls onComplete when complete button is clicked', async () => {
      const user = userEvent.setup();
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} />);

      const completeButton = screen.getByTitle('Mark as completed');
      await user.click(completeButton);

      expect(mockOnComplete).toHaveBeenCalledWith(activeGoal.id);
    });

    it('calls onEdit when edit button is clicked', async () => {
      const user = userEvent.setup();
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} onEdit={mockOnEdit} />);

      const editButton = screen.getByTitle('Edit goal');
      await user.click(editButton);

      expect(mockOnEdit).toHaveBeenCalledWith(activeGoal.id);
    });

    it('calls onDelete when delete button is clicked', async () => {
      const user = userEvent.setup();
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} />);

      const deleteButton = screen.getByTitle('Delete goal');
      await user.click(deleteButton);

      expect(mockOnDelete).toHaveBeenCalledWith(activeGoal.id);
    });
  });

  describe('Expand/Collapse Functionality', () => {
    it('shows expand button when enableExpandedView is true and goal is not completed', () => {
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} enableExpandedView={true} />);

      expect(screen.getByText('View details')).toBeInTheDocument();
    });

    it('does not show expand button when enableExpandedView is false', () => {
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} enableExpandedView={false} />);

      expect(screen.queryByText('View details')).not.toBeInTheDocument();
    });

    it('does not show expand button for completed goals', () => {
      const completedGoal = createMockGoal({ isCompleted: true });

      render(<GoalCard {...defaultProps} goal={completedGoal} enableExpandedView={true} />);

      expect(screen.queryByText('View details')).not.toBeInTheDocument();
    });

    it('toggles expanded state when expand button is clicked', async () => {
      const user = userEvent.setup();
      const activeGoal = createMockGoal({ isCompleted: false });
      const progress = createMockGoalProgress();

      render(
        <GoalCard
          {...defaultProps}
          goal={activeGoal}
          progress={progress}
          enableExpandedView={true}
        />
      );

      const expandButton = screen.getByText('View details');

      // Initially not expanded
      expect(screen.queryByTestId('goal-progress-chart')).not.toBeInTheDocument();

      // Click to expand
      await user.click(expandButton);

      expect(screen.getByText('Show less')).toBeInTheDocument();
      expect(screen.getByTestId('goal-progress-chart')).toBeInTheDocument();

      // Click to collapse
      await user.click(screen.getByText('Show less'));

      expect(screen.getByText('View details')).toBeInTheDocument();
      expect(screen.queryByTestId('goal-progress-chart')).not.toBeInTheDocument();
    });

    it('shows expanded content with progress chart when expanded', async () => {
      const user = userEvent.setup();
      const activeGoal = createMockGoal({ isCompleted: false });
      const progress = createMockGoalProgress();

      render(
        <GoalCard
          {...defaultProps}
          goal={activeGoal}
          progress={progress}
          enableExpandedView={true}
        />
      );

      const expandButton = screen.getByText('View details');
      await user.click(expandButton);

      const progressChart = screen.getByTestId('goal-progress-chart');
      expect(progressChart).toBeInTheDocument();
      expect(progressChart).toHaveAttribute('data-goal-id', activeGoal.id);
    });

    it('does not show expanded content when progress is not available', async () => {
      const user = userEvent.setup();
      const activeGoal = createMockGoal({ isCompleted: false });

      render(
        <GoalCard
          {...defaultProps}
          goal={activeGoal}
          progress={undefined}
          enableExpandedView={true}
        />
      );

      const expandButton = screen.getByText('View details');
      await user.click(expandButton);

      expect(screen.queryByTestId('goal-progress-chart')).not.toBeInTheDocument();
    });

    it('rotates expand icon when expanded', async () => {
      const user = userEvent.setup();
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} enableExpandedView={true} />);

      const expandIcon = document.querySelector('.expand-icon');
      expect(expandIcon).not.toHaveClass('expanded');

      const expandButton = screen.getByText('View details');
      await user.click(expandButton);

      expect(expandIcon).toHaveClass('expanded');
    });
  });

  describe('Detailed Progress View', () => {
    it('displays progress statistics in detailed view', () => {
      const goal = createMockGoal({
        targetValue: 50,
        targetUnit: 'km',
        currentValue: 32.5,
      });
      const progress = createMockGoalProgress({
        currentValue: 32.5,
      });

      render(
        <GoalCard {...defaultProps} goal={goal} progress={progress} showDetailedView={true} />
      );

      expect(screen.getByText('Current')).toBeInTheDocument();
      expect(screen.getByText('Target')).toBeInTheDocument();
      expect(screen.getByText('Remaining')).toBeInTheDocument();
      expect(screen.getByText('32.5km')).toBeInTheDocument();
      expect(screen.getByText('50.0km')).toBeInTheDocument();
      expect(screen.getByText('17.5km')).toBeInTheDocument();
    });

    it('uses goal color for circular progress', () => {
      const goal = createMockGoal({ color: '#ff5733' });
      const progress = createMockGoalProgress();

      render(
        <GoalCard {...defaultProps} goal={goal} progress={progress} showDetailedView={true} />
      );

      const circularProgress = screen.getByTestId('circular-progress');
      expect(circularProgress).toBeInTheDocument();
    });
  });

  describe('CSS Classes', () => {
    it('applies completed class for completed goals', () => {
      const completedGoal = createMockGoal({ isCompleted: true });

      const { container } = render(<GoalCard {...defaultProps} goal={completedGoal} />);

      const goalCard = container.querySelector('.goal-card');
      expect(goalCard).toHaveClass('completed');
    });

    it('does not apply completed class for active goals', () => {
      const activeGoal = createMockGoal({ isCompleted: false });

      const { container } = render(<GoalCard {...defaultProps} goal={activeGoal} />);

      const goalCard = container.querySelector('.goal-card');
      expect(goalCard).not.toHaveClass('completed');
    });
  });

  describe('Progress Bar Styling', () => {
    it('applies goal color to progress bar', () => {
      const goal = createMockGoal({ color: '#10b981' });
      const progress = createMockGoalProgress({ progressPercentage: 60 });

      render(<GoalCard {...defaultProps} goal={goal} progress={progress} />);

      const progressFill = document.querySelector('.progress-fill');
      expect(progressFill).toHaveStyle({ backgroundColor: '#10b981' });
    });

    it('sets correct progress bar width', () => {
      const progress = createMockGoalProgress({ progressPercentage: 75 });

      render(<GoalCard {...defaultProps} progress={progress} />);

      const progressFill = document.querySelector('.progress-fill');
      expect(progressFill).toHaveStyle({ width: '75%' });
    });

    it('caps progress bar width at 100%', () => {
      const progress = createMockGoalProgress({ progressPercentage: 120 });

      render(<GoalCard {...defaultProps} progress={progress} />);

      const progressFill = document.querySelector('.progress-fill');
      expect(progressFill).toHaveStyle({ width: '100%' });
    });

    it('applies completed class to progress fill for completed goals', () => {
      const completedGoal = createMockGoal({ isCompleted: true });
      const progress = createMockGoalProgress({ progressPercentage: 100 });

      render(<GoalCard {...defaultProps} goal={completedGoal} progress={progress} />);

      const progressFill = document.querySelector('.progress-fill');
      expect(progressFill).toHaveClass('completed');
    });
  });

  describe('Accessibility', () => {
    it('has accessible button labels', () => {
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} onEdit={mockOnEdit} />);

      expect(screen.getByTitle('Edit goal')).toBeInTheDocument();
      expect(screen.getByTitle('Mark as completed')).toBeInTheDocument();
      expect(screen.getByTitle('Delete goal')).toBeInTheDocument();
    });

    it('has accessible expand button label', () => {
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} enableExpandedView={true} />);

      expect(screen.getByTitle('Show detailed progress')).toBeInTheDocument();
    });

    it('updates expand button label when expanded', async () => {
      const user = userEvent.setup();
      const activeGoal = createMockGoal({ isCompleted: false });

      render(<GoalCard {...defaultProps} goal={activeGoal} enableExpandedView={true} />);

      const expandButton = screen.getByTitle('Show detailed progress');
      await user.click(expandButton);

      expect(screen.getByTitle('Show less')).toBeInTheDocument();
    });
  });
});
