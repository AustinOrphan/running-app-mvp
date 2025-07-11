import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';

import { GoalCard } from '../../src/components/GoalCard';
import { RunCard } from '../../src/components/Runs/RunCard';
import { GoalTemplateBrowser } from '../../src/components/Goals/GoalTemplateBrowser';
import { LoadingSpinner } from '../../src/components/Common/LoadingSpinner';

<<<<<<< HEAD
import { createMockGoal, createMockGoalProgress, createMockRun } from '../fixtures/mockData.js';
=======
import {
  mockGoals,
  createMockGoal,
  createMockGoalProgress,
  mockRuns,
  createMockRun,
} from '../fixtures/mockData.js';
>>>>>>> origin/main

expect.extend(toHaveNoViolations);

// Mock visualization components
vi.mock('../../src/components/Goals/CircularProgress', () => ({
  CircularProgress: ({ children, percentage }: any) => (
    <div data-testid='circular-progress' data-percentage={percentage}>
      {children}
    </div>
  ),
}));

vi.mock('../../src/components/Goals/GoalProgressChart', () => ({
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

// Mock template data
vi.mock('../../src/data/goalTemplates', () => ({
  GOAL_TEMPLATE_COLLECTIONS: [
    {
      title: 'Beginner Goals',
      description: 'Perfect for getting started',
      category: 'beginner',
      templates: [
        {
          id: 'template-1',
          name: '5K Training',
          description: 'Complete your first 5K',
          icon: '🏃',
          color: '#3b82f6',
          difficulty: 'beginner',
          type: 'DISTANCE',
          targetValue: 5,
          targetUnit: 'km',
          period: 'WEEKLY',
          estimatedTimeframe: '8 weeks',
          tags: ['distance', 'endurance'],
          tips: ['Start slow', 'Build gradually'],
          milestones: [
            { percentage: 25, description: 'First week complete' },
            { percentage: 50, description: 'Halfway there' },
          ],
        },
      ],
    },
  ],
<<<<<<< HEAD
  searchTemplates: vi.fn((_query: string) => []),
=======
  searchTemplates: vi.fn((query: string) => []),
>>>>>>> origin/main
}));

// Mock utilities
vi.mock('../../src/utils/formatters', () => ({
  formatDate: (date: string) => new Date(date).toLocaleDateString(),
  formatDuration: (duration: number) =>
    `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}`,
  calculatePace: (distance: number, duration: number) => {
    const paceSeconds = duration / distance;
    const minutes = Math.floor(paceSeconds / 60);
    const seconds = Math.round(paceSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  },
}));

describe('Card Variants Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GoalCard Integration', () => {
    const mockGoal = createMockGoal({
      id: 'goal-1',
      title: 'Weekly Running Goal',
      description: 'Run 25 kilometers this week',
      type: 'DISTANCE',
      targetValue: 25,
      targetUnit: 'km',
      color: '#3b82f6',
      icon: '🏃',
    });

    const mockProgress = createMockGoalProgress({
      goalId: 'goal-1',
      currentValue: 15,
      progressPercentage: 60,
      daysRemaining: 3,
    });

    it('renders goal card with new Card system', () => {
      render(
        <GoalCard
          goal={mockGoal}
          progress={mockProgress}
          onComplete={vi.fn()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
        />
      );

      // Check goal content
      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Weekly Running Goal');
      expect(screen.getByText('Run 25 kilometers this week')).toBeInTheDocument();
      expect(screen.getByText('60%')).toBeInTheDocument();
      expect(screen.getByText('3 days left')).toBeInTheDocument();

      // Check Card system is being used (verify new structure)
      const cardElement = screen.getByRole('heading').closest('[class*="card"]');
      expect(cardElement).toBeInTheDocument();
    });

    it('handles goal interactions correctly', async () => {
      const user = userEvent.setup();
      const mockOnEdit = vi.fn();
      const mockOnDelete = vi.fn();
      const mockOnComplete = vi.fn();

      render(
        <GoalCard
          goal={mockGoal}
          progress={mockProgress}
          onComplete={mockOnComplete}
          onDelete={mockOnDelete}
          onEdit={mockOnEdit}
        />
      );

      // Test edit button
      const editButton = screen.getByTitle('Edit goal');
      await user.click(editButton);
      expect(mockOnEdit).toHaveBeenCalledWith(mockGoal.id);

      // Test complete button
      const completeButton = screen.getByTitle('Mark as completed');
      await user.click(completeButton);
      expect(mockOnComplete).toHaveBeenCalledWith(mockGoal.id);

      // Test delete button
      const deleteButton = screen.getByTitle('Delete goal');
      await user.click(deleteButton);
      expect(mockOnDelete).toHaveBeenCalledWith(mockGoal.id);
    });

    it('shows completed state correctly', () => {
      const completedGoal = {
        ...mockGoal,
        isCompleted: true,
        completedAt: new Date().toISOString(),
      };

      render(
        <GoalCard
          goal={completedGoal}
          progress={mockProgress}
          onComplete={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      expect(screen.getByText('✅ Completed')).toBeInTheDocument();
      expect(screen.queryByTitle('Edit goal')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Mark as completed')).not.toBeInTheDocument();
    });

    it('supports expand/collapse functionality', async () => {
      const user = userEvent.setup();

      render(
        <GoalCard
          goal={mockGoal}
          progress={mockProgress}
          onComplete={vi.fn()}
          onDelete={vi.fn()}
          enableExpandedView={true}
        />
      );

      // Find expand button
      const expandButton = screen.getByText('View details');
      expect(expandButton).toBeInTheDocument();

      // Expand the card
      await user.click(expandButton);

      // Check expanded content appears
      await waitFor(() => {
        expect(screen.getByTestId('goal-progress-chart')).toBeInTheDocument();
      });

      // Collapse the card
      const collapseButton = screen.getByText('Show less');
      await user.click(collapseButton);

      // Check expanded content disappears
      await waitFor(() => {
        expect(screen.queryByTestId('goal-progress-chart')).not.toBeInTheDocument();
      });
    });

    it('maintains accessibility in goal cards', async () => {
      const { container } = render(
        <GoalCard
          goal={mockGoal}
          progress={mockProgress}
          onComplete={vi.fn()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
        />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('RunCard Integration', () => {
    const mockRun = createMockRun({
      id: 'run-1',
      date: '2024-01-15',
      distance: 5.2,
      duration: 1725, // 28:45
      tag: 'Morning Run',
      notes: 'Great weather today',
    });

    it('renders run card with new Card system', () => {
      render(<RunCard run={mockRun} onEdit={vi.fn()} onDelete={vi.fn()} />);

      // Check run content
      expect(screen.getByText('1/15/2024')).toBeInTheDocument(); // Formatted date
      expect(screen.getByText('5.2km')).toBeInTheDocument();
      expect(screen.getByText('28:45')).toBeInTheDocument();
      expect(screen.getByText('Great weather today')).toBeInTheDocument();

      // Check Card system is being used
      const cardElement = screen.getByText('5.2km').closest('[class*="card"]');
      expect(cardElement).toBeInTheDocument();
    });

    it('handles run interactions correctly', async () => {
      const user = userEvent.setup();
      const mockOnEdit = vi.fn();
      const mockOnDelete = vi.fn();

      // Mock window.confirm for delete action
      const originalConfirm = window.confirm;
      window.confirm = vi.fn(() => true);

      render(<RunCard run={mockRun} onEdit={mockOnEdit} onDelete={mockOnDelete} />);

      // Test edit button
      const editButton = screen.getByTitle('Edit run');
      await user.click(editButton);
      expect(mockOnEdit).toHaveBeenCalledWith(mockRun);

      // Test delete button
      const deleteButton = screen.getByTitle('Delete run');
      await user.click(deleteButton);
      expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to delete this run?');
      expect(mockOnDelete).toHaveBeenCalledWith(mockRun.id);

      // Restore original confirm
      window.confirm = originalConfirm;
    });

    it('handles delete cancellation', async () => {
      const user = userEvent.setup();
      const mockOnDelete = vi.fn();

      // Mock window.confirm to return false (cancel)
      const originalConfirm = window.confirm;
      window.confirm = vi.fn(() => false);

      render(<RunCard run={mockRun} onEdit={vi.fn()} onDelete={mockOnDelete} />);

      const deleteButton = screen.getByTitle('Delete run');
      await user.click(deleteButton);

      expect(window.confirm).toHaveBeenCalled();
      expect(mockOnDelete).not.toHaveBeenCalled();

      window.confirm = originalConfirm;
    });

    it('handles run without notes', () => {
      const runWithoutNotes = { ...mockRun, notes: undefined };

      render(<RunCard run={runWithoutNotes} onEdit={vi.fn()} onDelete={vi.fn()} />);

      expect(screen.getByText('5.2km')).toBeInTheDocument();
      expect(screen.queryByText('Great weather today')).not.toBeInTheDocument();
    });

    it('maintains accessibility in run cards', async () => {
      const { container } = render(<RunCard run={mockRun} onEdit={vi.fn()} onDelete={vi.fn()} />);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('TemplateCard Integration', () => {
    const mockTemplate = {
      id: 'template-1',
      name: '5K Training',
      description: 'Complete your first 5K',
      icon: '🏃',
      color: '#3b82f6',
      difficulty: 'beginner',
      type: 'DISTANCE',
      targetValue: 5,
      targetUnit: 'km',
      period: 'WEEKLY',
      estimatedTimeframe: '8 weeks',
      tags: ['distance', 'endurance'],
      tips: ['Start slow', 'Build gradually'],
      milestones: [
        { percentage: 25, description: 'First week complete' },
        { percentage: 50, description: 'Halfway there' },
      ],
    };

    it('renders template browser with new Card system', () => {
      render(<GoalTemplateBrowser isOpen={true} onClose={vi.fn()} onSelectTemplate={vi.fn()} />);

      // Check template browser is rendered
      expect(screen.getByText('Goal Templates')).toBeInTheDocument();
      expect(
        screen.getByText('Choose from proven running goals to jumpstart your training')
      ).toBeInTheDocument();

      // Check template card content
      expect(screen.getByText('5K Training')).toBeInTheDocument();
      expect(screen.getByText('Complete your first 5K')).toBeInTheDocument();
      expect(screen.getByText('Beginner')).toBeInTheDocument();
    });

    it('handles template selection', async () => {
      const user = userEvent.setup();
      const mockOnSelectTemplate = vi.fn();
      const mockOnClose = vi.fn();

      render(
        <GoalTemplateBrowser
          isOpen={true}
          onClose={mockOnClose}
          onSelectTemplate={mockOnSelectTemplate}
        />
      );

      // Click "Use This Template" button
      const selectButton = screen.getByText('Use This Template');
      await user.click(selectButton);

      expect(mockOnSelectTemplate).toHaveBeenCalledWith(mockTemplate);
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('handles template expansion', async () => {
      const user = userEvent.setup();

      render(<GoalTemplateBrowser isOpen={true} onClose={vi.fn()} onSelectTemplate={vi.fn()} />);

      // Expand template details
      const expandButton = screen.getByText('Learn More ↓');
      await user.click(expandButton);

      // Check expanded content
      expect(screen.getByText('Training Tips:')).toBeInTheDocument();
      expect(screen.getByText('Start slow')).toBeInTheDocument();
      expect(screen.getByText('Build gradually')).toBeInTheDocument();
      expect(screen.getByText('Milestones:')).toBeInTheDocument();

      // Collapse template details
      const collapseButton = screen.getByText('Show Less ↑');
      await user.click(collapseButton);

      // Check content is hidden
      expect(screen.queryByText('Training Tips:')).not.toBeInTheDocument();
    });

    it('handles modal close with escape key', async () => {
      const user = userEvent.setup();
      const mockOnClose = vi.fn();

      render(
        <GoalTemplateBrowser isOpen={true} onClose={mockOnClose} onSelectTemplate={vi.fn()} />
      );

      await user.keyboard('{Escape}');
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('maintains accessibility in template browser', async () => {
      const { container } = render(
        <GoalTemplateBrowser isOpen={true} onClose={vi.fn()} onSelectTemplate={vi.fn()} />
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('LoadingSpinner Integration', () => {
    it('renders loading cards with new Card system', () => {
      render(<LoadingSpinner count={3} />);

      // Check that skeleton cards are rendered
      const skeletonCards = screen
        .getAllByRole('generic')
        .filter(element => element.className.includes('skeleton'));

      expect(skeletonCards.length).toBeGreaterThan(0);

      // Check skeleton content
      const skeletonLines = document.querySelectorAll('.skeleton-line');
      expect(skeletonLines.length).toBeGreaterThan(0);
    });

    it('renders custom count of skeleton cards', () => {
      render(<LoadingSpinner count={5} />);

      const gridContainer = document.querySelector('.runs-grid');
      expect(gridContainer).toBeInTheDocument();
      expect(gridContainer?.children.length).toBe(5);
    });
  });

  describe('Card Grid Integration', () => {
    it('renders multiple goal cards in a grid', () => {
      const goals = [
        createMockGoal({ id: 'goal-1', title: 'Goal 1' }),
        createMockGoal({ id: 'goal-2', title: 'Goal 2' }),
        createMockGoal({ id: 'goal-3', title: 'Goal 3' }),
      ];

      render(
        <div className='goals-grid'>
<<<<<<< HEAD
          {goals.map((goal, _index) => (
=======
          {goals.map((goal, index) => (
>>>>>>> origin/main
            <GoalCard
              key={goal.id}
              goal={goal}
              progress={createMockGoalProgress({ goalId: goal.id })}
              onComplete={vi.fn()}
              onDelete={vi.fn()}
            />
          ))}
        </div>
      );

      // Check all goals are rendered
      expect(screen.getByText('Goal 1')).toBeInTheDocument();
      expect(screen.getByText('Goal 2')).toBeInTheDocument();
      expect(screen.getByText('Goal 3')).toBeInTheDocument();

      // Check grid structure
      const gridContainer = document.querySelector('.goals-grid');
      expect(gridContainer?.children.length).toBe(3);
    });

    it('renders multiple run cards in a grid', () => {
      const runs = [
        createMockRun({ id: 'run-1', distance: 5.0 }),
        createMockRun({ id: 'run-2', distance: 3.2 }),
        createMockRun({ id: 'run-3', distance: 8.5 }),
      ];

      render(
        <div className='runs-grid'>
          {runs.map(run => (
            <RunCard key={run.id} run={run} onEdit={vi.fn()} onDelete={vi.fn()} />
          ))}
        </div>
      );

      // Check all runs are rendered
      expect(screen.getByText('5km')).toBeInTheDocument();
      expect(screen.getByText('3.2km')).toBeInTheDocument();
      expect(screen.getByText('8.5km')).toBeInTheDocument();
    });

    it('maintains accessibility in card grids', async () => {
      const goals = [
        createMockGoal({ id: 'goal-1', title: 'Goal 1' }),
        createMockGoal({ id: 'goal-2', title: 'Goal 2' }),
      ];

      const { container } = render(
        <div className='goals-grid' role='grid'>
          {goals.map(goal => (
            <GoalCard
              key={goal.id}
              goal={goal}
              progress={createMockGoalProgress({ goalId: goal.id })}
              onComplete={vi.fn()}
              onDelete={vi.fn()}
            />
          ))}
        </div>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Card State Management', () => {
    it('handles card state changes correctly', async () => {
      const user = userEvent.setup();
      let goalState = createMockGoal({ id: 'goal-1', title: 'Dynamic Goal', isCompleted: false });
      const mockOnComplete = vi.fn(() => {
        goalState = { ...goalState, isCompleted: true };
      });

      const { rerender } = render(
        <GoalCard
          goal={goalState}
          progress={createMockGoalProgress({ goalId: 'goal-1' })}
          onComplete={mockOnComplete}
          onDelete={vi.fn()}
        />
      );

      // Initially not completed
      expect(screen.getByTitle('Mark as completed')).toBeInTheDocument();
      expect(screen.queryByText('✅ Completed')).not.toBeInTheDocument();

      // Complete the goal
      await user.click(screen.getByTitle('Mark as completed'));
      expect(mockOnComplete).toHaveBeenCalled();

      // Re-render with completed state
      rerender(
        <GoalCard
          goal={goalState}
          progress={createMockGoalProgress({ goalId: 'goal-1' })}
          onComplete={mockOnComplete}
          onDelete={vi.fn()}
        />
      );

      // Now should show completed state
      expect(screen.getByText('✅ Completed')).toBeInTheDocument();
      expect(screen.queryByTitle('Mark as completed')).not.toBeInTheDocument();
    });
  });

  describe('Card Error Handling', () => {
    it('handles missing data gracefully', () => {
      // Test with minimal data
      const minimalGoal = createMockGoal({
        id: 'minimal',
        title: 'Minimal Goal',
        description: undefined,
      });

      render(<GoalCard goal={minimalGoal} onComplete={vi.fn()} onDelete={vi.fn()} />);

      expect(screen.getByText('Minimal Goal')).toBeInTheDocument();
      // Should not crash without description or progress
    });

    it('handles invalid progress data', () => {
      const invalidProgress = createMockGoalProgress({
        goalId: 'goal-1',
        currentValue: -5, // Invalid negative value
        progressPercentage: 150, // Invalid percentage > 100
      });

      render(
        <GoalCard
          goal={createMockGoal({ id: 'goal-1' })}
          progress={invalidProgress}
          onComplete={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      // Should still render without crashing
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });
  });
});
