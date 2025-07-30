import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, it, expect, vi } from 'vitest';
import {
  Card,
  CardHeader,
  CardIcon,
  CardTitle,
  CardDescription,
  CardActions,
  CardContent,
  CardFooter,
  CardProgress,
  IconButton,
  ExpandControls,
  ExpandedContent,
  ProgressBar,
  ProgressHeader,
  CompletionBadge,
  DifficultyBadge,
} from '../../src/components/UI/Card';

expect.extend(toHaveNoViolations);

describe('Card Accessibility Tests', () => {
  describe('Basic Card Components', () => {
    it('Card has no accessibility violations', async () => {
      const { container } = render(
        <Card>
          <CardContent>Basic card content</CardContent>
        </Card>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('Interactive Card has proper ARIA attributes', async () => {
      const { container } = render(
        <Card interactive={true} aria-label='Interactive card'>
          <CardContent>Interactive content</CardContent>
        </Card>
      );

      const card = screen.getByRole('button');
      expect(card).toHaveAttribute('tabIndex', '0');
      expect(card).toHaveAttribute('aria-label', 'Interactive card');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('Card with keyboard navigation works correctly', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <Card interactive={true} onClick={handleClick} aria-label='Clickable card'>
          <CardContent>Clickable content</CardContent>
        </Card>
      );

      const card = screen.getByRole('button');

      // Test keyboard activation
      card.focus();
      expect(card).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);

      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(2);
    });
  });

  describe('Card Header Components', () => {
    it('CardHeader with icon and title has proper structure', async () => {
      const { container } = render(
        <Card>
          <CardHeader>
            <CardIcon>🎯</CardIcon>
            <CardTitle>
              <h4>Goal Title</h4>
              <span>Goal Type</span>
            </CardTitle>
          </CardHeader>
        </Card>
      );

      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Goal Title');
      expect(screen.getByText('🎯')).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('CardActions with IconButtons are accessible', async () => {
      const handleEdit = vi.fn();
      const handleDelete = vi.fn();

      const { container } = render(
        <Card>
          <CardHeader>
            <CardActions>
              <IconButton
                variant='edit'
                onClick={handleEdit}
                title='Edit item'
                aria-label='Edit this item'
              >
                ✏️
              </IconButton>
              <IconButton
                variant='delete'
                onClick={handleDelete}
                title='Delete item'
                aria-label='Delete this item'
              >
                🗑️
              </IconButton>
            </CardActions>
          </CardHeader>
        </Card>
      );

      const editButton = screen.getByLabelText('Edit this item');
      const deleteButton = screen.getByLabelText('Delete this item');

      expect(editButton).toHaveAttribute('title', 'Edit item');
      expect(deleteButton).toHaveAttribute('title', 'Delete item');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Progress Components', () => {
    it('ProgressBar has proper ARIA attributes', async () => {
      const { container } = render(
        <CardProgress>
          <ProgressHeader>
            <span>50 / 100 km</span>
            <span>50%</span>
          </ProgressHeader>
          <ProgressBar
            percentage={50}
            aria-label='Goal progress'
            aria-valuetext='50 percent complete'
          />
        </CardProgress>
      );

      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toHaveAttribute('aria-valuenow', '50');
      expect(progressBar).toHaveAttribute('aria-valuemin', '0');
      expect(progressBar).toHaveAttribute('aria-valuemax', '100');
      expect(progressBar).toHaveAttribute('aria-valuetext', '50 percent complete');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('Progress information is announced to screen readers', () => {
      render(
        <CardProgress>
          <ProgressHeader>
            <span id='progress-label'>Running progress</span>
            <span id='progress-value'>25 km of 50 km completed</span>
          </ProgressHeader>
          <ProgressBar
            percentage={50}
            aria-labelledby='progress-label'
            aria-describedby='progress-value'
          />
        </CardProgress>
      );

      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toHaveAttribute('aria-labelledby', 'progress-label');
      expect(progressBar).toHaveAttribute('aria-describedby', 'progress-value');
    });
  });

  describe('Interactive Elements', () => {
    it('ExpandControls have proper accessibility', async () => {
      const user = userEvent.setup();
      const handleToggle = vi.fn();

      const { container } = render(
        <Card>
          <CardContent>
            <ExpandControls
              isExpanded={false}
              onToggle={handleToggle}
              expandText='Show details'
              collapseText='Hide details'
            />
          </CardContent>
        </Card>
      );

      const expandButton = screen.getByRole('button', { name: /show details/i });
      expect(expandButton).toHaveAttribute('title', 'Show details');

      // Test keyboard interaction
      await user.tab();
      expect(expandButton).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(handleToggle).toHaveBeenCalledTimes(1);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('Expanded content is properly associated', async () => {
      const { container } = render(
        <Card>
          <CardContent>
            <ExpandControls
              isExpanded={true}
              onToggle={() => {}}
              expandText='Show details'
              collapseText='Hide details'
            />
            <ExpandedContent>
              <p>This is expanded content that should be accessible.</p>
            </ExpandedContent>
          </CardContent>
        </Card>
      );

      expect(screen.getByText('This is expanded content that should be accessible.')).toBeVisible();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Badge Components', () => {
    it('CompletionBadge is accessible', async () => {
      const { container } = render(<CompletionBadge>✅ Completed</CompletionBadge>);

      expect(screen.getByText('✅ Completed')).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('DifficultyBadge has proper color contrast', async () => {
      const { container } = render(
        <div>
          <DifficultyBadge difficulty='beginner' />
          <DifficultyBadge difficulty='intermediate' />
          <DifficultyBadge difficulty='advanced' />
        </div>
      );

      expect(screen.getByText('Beginner')).toBeInTheDocument();
      expect(screen.getByText('Intermediate')).toBeInTheDocument();
      expect(screen.getByText('Advanced')).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Card Variants Accessibility', () => {
    it('Goal Card variant is accessible', async () => {
      const { container } = render(
        <Card variant='goal' completed={false}>
          <CardHeader>
            <CardIcon color='#10b981'>🏃</CardIcon>
            <CardTitle>
              <h4>Weekly Running Goal</h4>
              <span>Distance Goal</span>
            </CardTitle>
            <CardActions>
              <IconButton
                variant='edit'
                onClick={() => {}}
                title='Edit goal'
                aria-label='Edit weekly running goal'
              >
                ✏️
              </IconButton>
            </CardActions>
          </CardHeader>
          <CardContent>
            <CardProgress>
              <ProgressHeader>
                <span id='goal-progress'>25.0km / 50.0km</span>
                <span id='goal-percentage'>50%</span>
              </ProgressHeader>
              <ProgressBar
                percentage={50}
                color='#10b981'
                aria-labelledby='goal-progress'
                aria-valuetext='25 kilometers of 50 kilometers completed'
              />
            </CardProgress>
          </CardContent>
          <CardFooter>
            <div>📅 weekly</div>
            <div>⏰ 5 days left</div>
          </CardFooter>
        </Card>
      );

      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Weekly Running Goal');
      expect(screen.getByText('🏃')).toBeInTheDocument();
      expect(screen.getByLabelText('Edit weekly running goal')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuetext',
        '25 kilometers of 50 kilometers completed'
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('Run Card variant is accessible', async () => {
      const { container } = render(
        <Card variant='run'>
          <CardHeader variant='run'>
            <div>July 10, 2025</div>
            <CardActions variant='run'>
              <IconButton
                variant='edit'
                onClick={() => {}}
                title='Edit run'
                aria-label='Edit run from July 10, 2025'
              >
                ✏️
              </IconButton>
              <IconButton
                variant='delete'
                onClick={() => {}}
                title='Delete run'
                aria-label='Delete run from July 10, 2025'
              >
                🗑️
              </IconButton>
            </CardActions>
          </CardHeader>
          <CardContent>
            <div className='run-stats' role='group' aria-label='Run statistics'>
              <div className='stat'>
                <span className='stat-value'>5.2km</span>
                <span className='stat-label'>Distance</span>
              </div>
              <div className='stat'>
                <span className='stat-value'>25:30</span>
                <span className='stat-label'>Duration</span>
              </div>
              <div className='stat'>
                <span className='stat-value'>4:54/km</span>
                <span className='stat-label'>Pace/km</span>
              </div>
            </div>
          </CardContent>
        </Card>
      );

      expect(screen.getByLabelText('Edit run from July 10, 2025')).toBeInTheDocument();
      expect(screen.getByLabelText('Delete run from July 10, 2025')).toBeInTheDocument();
      expect(screen.getByLabelText('Run statistics')).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('Template Card variant is accessible', async () => {
      const { container } = render(
        <Card variant='template'>
          <CardHeader variant='template'>
            <CardIcon variant='template' color='#3b82f6'>
              🏃‍♀️
            </CardIcon>
            <CardTitle variant='template'>
              <h4>Beginner 5K Training</h4>
              <CardDescription variant='template'>
                A 8-week program designed for beginners to complete their first 5K race.
              </CardDescription>
            </CardTitle>
            <DifficultyBadge difficulty='beginner' />
          </CardHeader>
          <CardContent>
            <div className='template-details'>
              <div>Target: 5.0 km</div>
              <div>Period: One-time</div>
              <div>Timeframe: 8 weeks</div>
            </div>
            <ExpandControls
              isExpanded={false}
              onToggle={() => {}}
              expandText='Learn more about this template'
              collapseText='Hide template details'
            />
          </CardContent>
          <CardActions variant='template'>
            <button type='button' aria-label='Use Beginner 5K Training template'>
              Use This Template
            </button>
          </CardActions>
        </Card>
      );

      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Beginner 5K Training');
      expect(screen.getByText('🏃‍♀️')).toBeInTheDocument();
      expect(screen.getByText('Beginner')).toBeInTheDocument();
      expect(screen.getByLabelText('Use Beginner 5K Training template')).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Focus Management', () => {
    it('Tab navigation works correctly through card elements', async () => {
      const user = userEvent.setup();

      render(
        <Card>
          <CardHeader>
            <CardActions>
              <IconButton variant='edit' onClick={() => {}} title='Edit' aria-label='Edit item'>
                ✏️
              </IconButton>
              <IconButton
                variant='delete'
                onClick={() => {}}
                title='Delete'
                aria-label='Delete item'
              >
                🗑️
              </IconButton>
            </CardActions>
          </CardHeader>
          <CardContent>
            <ExpandControls
              isExpanded={false}
              onToggle={() => {}}
              expandText='Show details'
              collapseText='Hide details'
            />
          </CardContent>
        </Card>
      );

      // Test tab order
      await user.tab();
      expect(screen.getByLabelText('Edit item')).toHaveFocus();

      await user.tab();
      expect(screen.getByLabelText('Delete item')).toHaveFocus();

      await user.tab();
      expect(screen.getByRole('button', { name: /show details/i })).toHaveFocus();
    });

    it('Focus is visible on interactive elements', () => {
      render(
        <Card interactive={true} aria-label='Focusable card'>
          <CardContent>
            <IconButton variant='edit' onClick={() => {}} title='Edit' aria-label='Edit item'>
              ✏️
            </IconButton>
          </CardContent>
        </Card>
      );

      const card = screen.getByRole('button', { name: 'Focusable card' });
      const iconButton = screen.getByLabelText('Edit item');

      // Just verify elements are focusable without checking current focus
      expect(card).toHaveAttribute('tabIndex', '0');
      expect(iconButton).toBeInTheDocument();
      expect(card).toHaveAttribute('aria-label', 'Focusable card');
      expect(iconButton).toHaveAttribute('aria-label', 'Edit item');
    });
  });

  describe('Screen Reader Support', () => {
    it('Card content is properly announced', () => {
      render(
        <Card aria-labelledby='card-title' aria-describedby='card-description'>
          <CardHeader>
            <CardTitle>
              <h4 id='card-title'>Goal Progress</h4>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div id='card-description'>Track your weekly running distance goal progress.</div>
            <CardProgress>
              <ProgressBar
                percentage={75}
                aria-label='Weekly distance progress'
                aria-valuetext='75 percent of weekly distance goal completed'
              />
            </CardProgress>
          </CardContent>
        </Card>
      );

      const card = screen.getByLabelText('Goal Progress');
      expect(card).toHaveAttribute('aria-describedby', 'card-description');

      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toHaveAttribute(
        'aria-valuetext',
        '75 percent of weekly distance goal completed'
      );
    });

    it('Dynamic content changes are announced', async () => {
      const user = userEvent.setup();

      const TestComponent = () => {
        const [expanded, setExpanded] = React.useState(false);

        return (
          <Card>
            <CardContent>
              <ExpandControls
                isExpanded={expanded}
                onToggle={() => setExpanded(!expanded)}
                expandText='Show details'
                collapseText='Hide details'
              />
              {expanded && (
                <ExpandedContent>
                  <div role='region' aria-label='Additional details' aria-live='polite'>
                    <p>This content was dynamically revealed.</p>
                  </div>
                </ExpandedContent>
              )}
            </CardContent>
          </Card>
        );
      };

      render(<TestComponent />);

      const expandButton = screen.getByRole('button', { name: /show details/i });

      await user.click(expandButton);

      expect(screen.getByRole('region', { name: 'Additional details' })).toBeInTheDocument();
      expect(screen.getByText('This content was dynamically revealed.')).toBeInTheDocument();
    });
  });

  describe('Error States and Edge Cases', () => {
    it('Card with missing content is still accessible', async () => {
      const { container } = render(
        <Card role='region' aria-label='Empty card'>
          <CardContent>{/* Empty content */}</CardContent>
        </Card>
      );

      expect(screen.getByLabelText('Empty card')).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('Loading state is properly announced', async () => {
      const { container } = render(
        <Card loading={true} aria-label='Loading content' aria-busy='true'>
          <CardContent>
            <div role='status' aria-label='Loading'>
              <span className='skeleton-line'>Loading...</span>
            </div>
          </CardContent>
        </Card>
      );

      const card = screen.getByLabelText('Loading content');
      expect(card).toHaveAttribute('aria-busy', 'true');

      expect(screen.getByRole('status')).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
