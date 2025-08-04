import { render, screen, fireEvent } from '@testing-library/react';
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

      const cardElement = container.firstChild as HTMLElement;
      expect(cardElement.className).toMatch(/cardGoal/);

      rerender(<Card variant='run'>Test</Card>);
      expect(cardElement.className).toMatch(/cardRun/);

      rerender(<Card variant='template'>Test</Card>);
      expect(cardElement.className).toMatch(/cardTemplate/);
    });

    it('applies state classes correctly', () => {
      const { rerender, container } = render(<Card completed={true}>Test</Card>);

      const cardElement = container.firstChild as HTMLElement;
      expect(cardElement.className).toMatch(/cardCompleted/);

      rerender(<Card interactive={true}>Test</Card>);
      expect(cardElement.className).toMatch(/cardInteractive/);

      rerender(<Card loading={true}>Test</Card>);
      expect(cardElement.className).toMatch(/cardLoading/);
    });

    it('supports custom className', () => {
      const { container } = render(<Card className='custom-class'>Test</Card>);

      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('handles interactive behavior', () => {
      const handleClick = vi.fn();

      const { container } = render(
        <Card interactive={true} onClick={handleClick}>
          Test content
        </Card>
      );

      const card = container.firstChild as HTMLElement;

      // The card should have button attributes when interactive and no nested interactive elements
      expect(card).toHaveAttribute('role', 'button');
      expect(card).toHaveAttribute('tabIndex', '0');

      fireEvent.click(card!);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('supports keyboard interaction', () => {
      const handleClick = vi.fn();

      const { container } = render(
        <Card interactive={true} onClick={handleClick}>
          Test content
        </Card>
      );

      const card = container.firstChild as HTMLElement;

      // Test Enter key
      card!.focus();
      fireEvent.keyDown(card!, { key: 'Enter' });
      expect(handleClick).toHaveBeenCalledTimes(1);

      // Test Space key
      fireEvent.keyDown(card!, { key: ' ' });
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

      const headerElement = container.firstChild as HTMLElement;
      expect(headerElement.className).toMatch(/cardHeader/);
      expect(screen.getByText('Header content')).toBeInTheDocument();
    });

    it('applies variant-specific classes', () => {
      const { rerender, container } = render(<CardHeader variant='template'>Test</CardHeader>);

      const headerElement = container.firstChild as HTMLElement;
      expect(headerElement.className).toMatch(/cardHeaderTemplate/);

      rerender(<CardHeader variant='run'>Test</CardHeader>);
      expect(headerElement.className).toMatch(/cardHeaderRun/);
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

      const iconElement = container.firstChild as HTMLElement;
      expect(iconElement.className).toMatch(/cardIconTemplate/);
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

      const titleElement = container.firstChild as HTMLElement;
      expect(titleElement.className).toMatch(/cardTitleTemplate/);
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

      const descElement = container.firstChild as HTMLElement;
      expect(descElement.className).toMatch(/cardDescriptionTemplate/);
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

      const actionsElement = container.firstChild as HTMLElement;
      expect(actionsElement.className).toMatch(/cardActionsRun/);

      rerender(<CardActions variant='template'>Actions</CardActions>);
      expect(actionsElement.className).toMatch(/cardActionsTemplate/);
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
      const handleClick = vi.fn();

      render(<IconButton onClick={handleClick}>✏️</IconButton>);

      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('applies variant classes', () => {
      const { rerender, container } = render(<IconButton variant='run'>✏️</IconButton>);

      const buttonElement = container.firstChild as HTMLElement;
      expect(buttonElement.className).toMatch(/iconBtnRun/);

      rerender(<IconButton variant='delete'>🗑️</IconButton>);
      expect(buttonElement.className).toMatch(/iconBtnDelete/);

      rerender(<IconButton variant='edit'>✏️</IconButton>);
      expect(buttonElement.className).toMatch(/iconBtnEdit/);
    });

    it('supports keyboard activation', async () => {
      const handleClick = vi.fn();

      render(<IconButton onClick={handleClick}>✏️</IconButton>);

      const button = screen.getByRole('button');
      button.focus();

      fireEvent.keyDown(card!, {'{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(card!, {' ');
      expect(handleClick).toHaveBeenCalledTimes(2);
    });
  });

  describe('ProgressBar', () => {
    it('renders progress bar with correct percentage', () => {
      const { container } = render(<ProgressBar percentage={75} />);

      const progressFill = container.querySelector('[class*="progressFill"]');
      expect(progressFill).toHaveStyle({ transform: 'scaleX(0.75)' });
    });

    it('applies custom color', () => {
      const { container } = render(<ProgressBar percentage={50} color='#ff0000' />);

      const progressFill = container.querySelector('[class*="progressFill"]');
      expect(progressFill).toHaveStyle({ backgroundColor: '#ff0000' });
    });

    it('handles completed state', () => {
      const { container } = render(<ProgressBar percentage={100} completed={true} />);

      const progressFill = container.querySelector('[class*="progressFill"]') as HTMLElement;
      expect(progressFill.className).toMatch(/progressFillCompleted/);
    });

    it('caps percentage at 100', () => {
      const { container } = render(<ProgressBar percentage={150} />);

      const progressFill = container.querySelector('[class*="progressFill"]');
      expect(progressFill).toHaveStyle({ transform: 'scaleX(1)' });
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
      const handleToggle = vi.fn();

      render(<ExpandControls isExpanded={false} onToggle={handleToggle} />);

      fireEvent.click(screen.getByRole('button'));
      expect(handleToggle).toHaveBeenCalledTimes(1);
    });

    it('applies expanded icon class when expanded', () => {
      const { container } = render(<ExpandControls isExpanded={true} onToggle={vi.fn()} />);

      const icon = container.querySelector('[class*="expandIcon"]') as HTMLElement;
      expect(icon.className).toMatch(/expandIconExpanded/);
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

      const contentElement = container.firstChild as HTMLElement;
      expect(contentElement.className).toMatch(/expandedContent/);
    });
  });

  describe('CompletionBadge', () => {
    it('renders badge content', () => {
      render(<CompletionBadge>✅ Completed</CompletionBadge>);

      expect(screen.getByText('✅ Completed')).toBeInTheDocument();
    });

    it('applies correct CSS classes', () => {
      const { container } = render(<CompletionBadge>Completed</CompletionBadge>);

      const badgeElement = container.firstChild as HTMLElement;
      expect(badgeElement.className).toMatch(/completionBadge/);
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
      fireEvent.click(screen.getByTitle('Edit goal'));
      expect(handleEdit).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTitle('Delete goal'));
      expect(handleDelete).toHaveBeenCalledTimes(1);
    });

    it('maintains accessibility in complex cards', async () => {
      const { container } = render(
        <Card variant='template' aria-label='Template card'>
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

      // Should still render without throwing and cap negative values at 0
      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toBeInTheDocument();
      expect(progressBar).toHaveAttribute('aria-valuenow', '0');
    });

    it('handles missing event handlers', async () => {

      render(<IconButton>✏️</IconButton>);

      // Should not throw when clicked without handler
      expect(async () => {
        fireEvent.click(screen.getByRole('button'));
      }).not.toThrow();
    });
  });
});
