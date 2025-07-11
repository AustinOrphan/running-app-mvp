import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';

import {
  Card,
  CardHeader,
  CardIcon,
  CardTitle,
  CardDescription,
  CardContent,
  CardActions,
  CardFooter,
  CardProgress,
  IconButton,
  ProgressBar,
  ProgressHeader,
<<<<<<< HEAD
=======

>>>>>>> origin/main
  SimpleProgress,
  ExpandControls,
  ExpandedContent,
  CompletionBadge,
  DifficultyBadge,
} from '../../../../src/components/UI/Card';

expect.extend(toHaveNoViolations);

describe('Card Component System', () => {
  describe('Card', () => {
    it('renders with default props', () => {
      render(
        <Card>
          <div>Test content</div>
        </Card>
      );

      expect(screen.getByText('Test content')).toBeInTheDocument();
    });

    it('applies correct variant classes', () => {
      const { rerender, container } = render(<Card variant='goal'>Test</Card>);

      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardGoal/));

      rerender(<Card variant='run'>Test</Card>);
      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardRun/));

      rerender(<Card variant='template'>Test</Card>);
      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardTemplate/));
    });

    it('applies state classes correctly', () => {
      const { rerender, container } = render(<Card completed={true}>Test</Card>);

      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardCompleted/));

      rerender(<Card interactive={true}>Test</Card>);
      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardInteractive/));

      rerender(<Card loading={true}>Test</Card>);
      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardLoading/));
    });

    it('supports custom className', () => {
      const { container } = render(<Card className='custom-class'>Test</Card>);

      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('handles interactive behavior', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <Card interactive={true} onClick={handleClick}>
          Test content
        </Card>
      );

      const card = screen.getByText('Test content').parentElement;

      expect(card).toHaveAttribute('role', 'button');
      expect(card).toHaveAttribute('tabIndex', '0');

      await user.click(card!);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('supports keyboard interaction', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <Card interactive={true} onClick={handleClick}>
          Test content
        </Card>
      );

      const card = screen.getByText('Test content').parentElement;

      // Test Enter key
      card!.focus();
      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);

      // Test Space key
      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(2);
    });

    it('forwards ref correctly', () => {
      const ref = vi.fn();

      render(<Card ref={ref}>Test content</Card>);

      expect(ref).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    });

    it('has no accessibility violations', async () => {
      const { container } = render(
        <Card interactive={true} aria-label='Test card'>
          <CardHeader>
            <CardTitle>
              <h4>Test Title</h4>
            </CardTitle>
          </CardHeader>
          <CardContent>Test content</CardContent>
        </Card>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('CardHeader', () => {
    it('renders with default variant', () => {
      const { container } = render(
        <CardHeader>
          <div>Header content</div>
        </CardHeader>
      );

      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardHeader/));
      expect(screen.getByText('Header content')).toBeInTheDocument();
    });

    it('applies variant-specific classes', () => {
      const { rerender, container } = render(<CardHeader variant='template'>Test</CardHeader>);

      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardHeaderTemplate/));

      rerender(<CardHeader variant='run'>Test</CardHeader>);
      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardHeaderRun/));
    });
  });

  describe('CardIcon', () => {
    it('renders icon content', () => {
      render(<CardIcon>🏃</CardIcon>);

      expect(screen.getByText('🏃')).toBeInTheDocument();
    });

    it('applies custom color', () => {
      const { container } = render(<CardIcon color='#ff0000'>🏃</CardIcon>);

      const icon = container.firstChild as HTMLElement;
      expect(icon).toHaveStyle({ color: '#ff0000' });
    });

    it('applies variant classes', () => {
      const { container } = render(<CardIcon variant='template'>🏃</CardIcon>);

      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardIconTemplate/));
    });
  });

  describe('CardTitle', () => {
    it('renders title content', () => {
      render(
        <CardTitle>
          <h4>Test Title</h4>
          <span>Subtitle</span>
        </CardTitle>
      );

      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Test Title');
      expect(screen.getByText('Subtitle')).toBeInTheDocument();
    });

    it('applies variant classes', () => {
      const { container } = render(<CardTitle variant='template'>Title</CardTitle>);

      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardTitleTemplate/));
    });
  });

  describe('CardDescription', () => {
    it('renders as paragraph element', () => {
      render(<CardDescription>This is a test description</CardDescription>);

      const description = screen.getByText('This is a test description');
      expect(description.tagName).toBe('P');
    });

    it('applies variant classes', () => {
      const { container } = render(
        <CardDescription variant='template'>Description</CardDescription>
      );

      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardDescriptionTemplate/));
    });
  });

  describe('CardActions', () => {
    it('renders action buttons', () => {
      render(
        <CardActions>
          <button>Edit</button>
          <button>Delete</button>
        </CardActions>
      );

      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('applies variant-specific classes', () => {
      const { rerender, container } = render(<CardActions variant='run'>Actions</CardActions>);

      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardActionsRun/));

      rerender(<CardActions variant='template'>Actions</CardActions>);
      expect(container.firstChild).toHaveClass(expect.stringMatching(/cardActionsTemplate/));
    });
  });

  describe('IconButton', () => {
    it('renders button with icon', () => {
      render(<IconButton title='Edit'>✏️</IconButton>);

      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('✏️');
      expect(button).toHaveAttribute('title', 'Edit');
    });

    it('handles click events', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(<IconButton onClick={handleClick}>✏️</IconButton>);

      await user.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('applies variant classes', () => {
      const { rerender, container } = render(<IconButton variant='run'>✏️</IconButton>);

      expect(container.firstChild).toHaveClass(expect.stringMatching(/iconBtnRun/));

      rerender(<IconButton variant='delete'>🗑️</IconButton>);
      expect(container.firstChild).toHaveClass(expect.stringMatching(/iconBtnDelete/));

      rerender(<IconButton variant='edit'>✏️</IconButton>);
      expect(container.firstChild).toHaveClass(expect.stringMatching(/iconBtnEdit/));
    });

    it('supports keyboard activation', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(<IconButton onClick={handleClick}>✏️</IconButton>);

      const button = screen.getByRole('button');
      button.focus();

      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);

      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(2);
    });
  });

  describe('ProgressBar', () => {
    it('renders progress bar with correct percentage', () => {
      const { container } = render(<ProgressBar percentage={75} />);

      const progressFill = container.querySelector(`.${expect.stringMatching(/progressFill/)}`);
      expect(progressFill).toHaveStyle({ width: '75%' });
    });

    it('applies custom color', () => {
      const { container } = render(<ProgressBar percentage={50} color='#ff0000' />);

      const progressFill = container.querySelector(`.${expect.stringMatching(/progressFill/)}`);
      expect(progressFill).toHaveStyle({ backgroundColor: '#ff0000' });
    });

    it('handles completed state', () => {
      const { container } = render(<ProgressBar percentage={100} completed={true} />);

      const progressFill = container.querySelector(`.${expect.stringMatching(/progressFill/)}`);
      expect(progressFill).toHaveClass(expect.stringMatching(/progressFillCompleted/));
    });

    it('caps percentage at 100', () => {
      const { container } = render(<ProgressBar percentage={150} />);

      const progressFill = container.querySelector(`.${expect.stringMatching(/progressFill/)}`);
      expect(progressFill).toHaveStyle({ width: '100%' });
    });
  });

  describe('ExpandControls', () => {
    it('renders expand button with correct text', () => {
      render(
        <ExpandControls
          isExpanded={false}
          onToggle={vi.fn()}
          expandText='Show More'
          collapseText='Show Less'
        />
      );

      expect(screen.getByText('Show More')).toBeInTheDocument();
      expect(screen.getByText('▼')).toBeInTheDocument();
    });

    it('shows collapse text when expanded', () => {
      render(
        <ExpandControls
          isExpanded={true}
          onToggle={vi.fn()}
          expandText='Show More'
          collapseText='Show Less'
        />
      );

      expect(screen.getByText('Show Less')).toBeInTheDocument();
    });

    it('calls onToggle when clicked', async () => {
      const user = userEvent.setup();
      const handleToggle = vi.fn();

      render(<ExpandControls isExpanded={false} onToggle={handleToggle} />);

      await user.click(screen.getByRole('button'));
      expect(handleToggle).toHaveBeenCalledTimes(1);
    });

    it('applies expanded icon class when expanded', () => {
      const { container } = render(<ExpandControls isExpanded={true} onToggle={vi.fn()} />);

      const icon = container.querySelector(`.${expect.stringMatching(/expandIcon/)}`);
      expect(icon).toHaveClass(expect.stringMatching(/expandIconExpanded/));
    });
  });

  describe('ExpandedContent', () => {
    it('renders expanded content', () => {
      render(
        <ExpandedContent>
          <div>Expanded content here</div>
        </ExpandedContent>
      );

      expect(screen.getByText('Expanded content here')).toBeInTheDocument();
    });

    it('applies correct CSS classes', () => {
      const { container } = render(<ExpandedContent>Content</ExpandedContent>);

      expect(container.firstChild).toHaveClass(expect.stringMatching(/expandedContent/));
    });
  });

  describe('CompletionBadge', () => {
    it('renders badge content', () => {
      render(<CompletionBadge>✅ Completed</CompletionBadge>);

      expect(screen.getByText('✅ Completed')).toBeInTheDocument();
    });

    it('applies correct CSS classes', () => {
      const { container } = render(<CompletionBadge>Completed</CompletionBadge>);

      expect(container.firstChild).toHaveClass(expect.stringMatching(/completionBadge/));
    });
  });

  describe('DifficultyBadge', () => {
    it('renders difficulty with proper capitalization', () => {
      render(<DifficultyBadge difficulty='beginner' />);

      expect(screen.getByText('Beginner')).toBeInTheDocument();
    });

    it('applies correct colors for different difficulties', () => {
      const { rerender, container } = render(<DifficultyBadge difficulty='beginner' />);

      let badge = container.firstChild as HTMLElement;
      expect(badge).toHaveStyle({ backgroundColor: '#10b981' });

      rerender(<DifficultyBadge difficulty='intermediate' />);
      badge = container.firstChild as HTMLElement;
      expect(badge).toHaveStyle({ backgroundColor: '#f59e0b' });

      rerender(<DifficultyBadge difficulty='advanced' />);
      badge = container.firstChild as HTMLElement;
      expect(badge).toHaveStyle({ backgroundColor: '#ef4444' });
    });

    it('handles unknown difficulty levels', () => {
      const { container } = render(<DifficultyBadge difficulty='unknown' />);

      const badge = container.firstChild as HTMLElement;
      expect(badge).toHaveStyle({ backgroundColor: '#6b7280' });
      expect(badge).toHaveTextContent('Unknown');
    });
  });

  describe('Integration Tests', () => {
    it('works together in a complete card', async () => {
      const user = userEvent.setup();
      const handleEdit = vi.fn();
      const handleDelete = vi.fn();

      render(
        <Card variant='goal' completed={false}>
          <CardHeader>
            <CardIcon color='#3b82f6'>🏃</CardIcon>
            <CardTitle>
              <h4>Weekly Running Goal</h4>
              <span>Distance Goal</span>
            </CardTitle>
            <CardActions>
              <IconButton onClick={handleEdit} title='Edit goal'>
                ✏️
              </IconButton>
              <IconButton onClick={handleDelete} title='Delete goal'>
                🗑️
              </IconButton>
            </CardActions>
          </CardHeader>

          <CardDescription>Run 25 kilometers this week</CardDescription>

          <CardContent>
            <CardProgress>
              <SimpleProgress>
                <ProgressHeader>
                  <span>15 / 25 km</span>
                  <span>60%</span>
                </ProgressHeader>
                <ProgressBar percentage={60} color='#3b82f6' />
              </SimpleProgress>
            </CardProgress>
          </CardContent>

          <CardFooter>
            <span>📅 Weekly</span>
            <span>⏰ 3 days left</span>
          </CardFooter>
        </Card>
      );

      // Check content is rendered
      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Weekly Running Goal');
      expect(screen.getByText('Distance Goal')).toBeInTheDocument();
      expect(screen.getByText('Run 25 kilometers this week')).toBeInTheDocument();
      expect(screen.getByText('15 / 25 km')).toBeInTheDocument();
      expect(screen.getByText('60%')).toBeInTheDocument();

      // Test interactions
      await user.click(screen.getByTitle('Edit goal'));
      expect(handleEdit).toHaveBeenCalledTimes(1);

      await user.click(screen.getByTitle('Delete goal'));
      expect(handleDelete).toHaveBeenCalledTimes(1);
    });

    it('maintains accessibility in complex cards', async () => {
      const { container } = render(
        <Card variant='template' interactive={true} aria-label='Template card'>
          <CardHeader variant='template'>
            <CardIcon variant='template' color='#f59e0b'>
              🎯
            </CardIcon>
            <CardTitle variant='template'>
              <h4>5K Training Plan</h4>
              <CardDescription variant='template'>
                Complete beginner-friendly 5K training
              </CardDescription>
            </CardTitle>
            <DifficultyBadge difficulty='beginner' />
          </CardHeader>

          <CardContent>
            <div className='template-details'>
              <div>Target: 5 kilometers</div>
              <div>Duration: 8 weeks</div>
            </div>
          </CardContent>

          <CardActions variant='template'>
            <button>Learn More</button>
            <button>Use Template</button>
          </CardActions>
        </Card>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Error Handling', () => {
    it('handles missing props gracefully', () => {
      expect(() => {
        render(<Card>{null}</Card>);
      }).not.toThrow();
    });

    it('handles invalid percentage values', () => {
      render(<ProgressBar percentage={-10} />);

      // Should still render without throwing
      expect(screen.getByRole('progressbar', { hidden: true })).toBeInTheDocument();
    });

    it('handles missing event handlers', async () => {
      const user = userEvent.setup();

      render(<IconButton>✏️</IconButton>);

      // Should not throw when clicked without handler
      expect(async () => {
        await user.click(screen.getByRole('button'));
      }).not.toThrow();
    });
  });
});
