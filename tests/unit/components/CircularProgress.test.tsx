import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CircularProgress } from '../../../src/components/Goals/CircularProgress';

describe('CircularProgress', () => {
  describe('Basic Rendering', () => {
    it('renders with default props', () => {
      render(<CircularProgress percentage={50} />);
      
      const svg = document.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('width', '120');
      expect(svg).toHaveAttribute('height', '120');
    });

    it('renders with custom size', () => {
      render(<CircularProgress percentage={75} size={100} />);
      
      const svg = document.querySelector('svg');
      expect(svg).toHaveAttribute('width', '100');
      expect(svg).toHaveAttribute('height', '100');
    });

    it('renders with custom colors', () => {
      const customColor = '#ff5733';
      const customBgColor = '#333333';
      
      render(
        <CircularProgress 
          percentage={60} 
          color={customColor}
          backgroundColor={customBgColor}
        />
      );
      
      const progressCircle = document.querySelector('.progress-foreground');
      const backgroundCircle = document.querySelector('.progress-background');
      
      expect(progressCircle).toHaveAttribute('stroke', customColor);
      expect(backgroundCircle).toHaveAttribute('stroke', customBgColor);
    });

    it('applies custom className', () => {
      const customClass = 'custom-progress';
      render(<CircularProgress percentage={50} className={customClass} />);
      
      const container = document.querySelector('.circular-progress');
      expect(container).toHaveClass(customClass);
    });
  });

  describe('Progress Calculation', () => {
    it('correctly calculates stroke-dashoffset for 0%', () => {
      render(<CircularProgress percentage={0} size={120} strokeWidth={8} />);
      
      const progressCircle = document.querySelector('.progress-foreground');
      const radius = (120 - 8) / 2; // 56
      const circumference = radius * 2 * Math.PI; // ~351.86
      
      expect(progressCircle).toHaveAttribute('stroke-dasharray', circumference.toString());
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', circumference.toString());
    });

    it('correctly calculates stroke-dashoffset for 50%', () => {
      render(<CircularProgress percentage={50} size={120} strokeWidth={8} />);
      
      const progressCircle = document.querySelector('.progress-foreground');
      const radius = (120 - 8) / 2;
      const circumference = radius * 2 * Math.PI;
      const expectedOffset = circumference - (50 / 100) * circumference;
      
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', expectedOffset.toString());
    });

    it('correctly calculates stroke-dashoffset for 100%', () => {
      render(<CircularProgress percentage={100} size={120} strokeWidth={8} />);
      
      const progressCircle = document.querySelector('.progress-foreground');
      const radius = (120 - 8) / 2;
      const circumference = radius * 2 * Math.PI;
      const expectedOffset = circumference - circumference; // 0
      
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', '0');
    });

    it('clamps percentage above 100% to 100%', () => {
      render(<CircularProgress percentage={150} size={120} strokeWidth={8} />);
      
      const progressCircle = document.querySelector('.progress-foreground');
      const radius = (120 - 8) / 2;
      const circumference = radius * 2 * Math.PI;
      
      // Should behave as if percentage was 100%
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', '0');
    });

    it('handles negative percentage as 0%', () => {
      render(<CircularProgress percentage={-25} size={120} strokeWidth={8} />);
      
      const progressCircle = document.querySelector('.progress-foreground');
      const radius = (120 - 8) / 2;
      const circumference = radius * 2 * Math.PI;
      
      // Should behave as if percentage was 0%
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', circumference.toString());
    });
  });

  describe('Animation', () => {
    it('applies animated class when animated is true', () => {
      render(<CircularProgress percentage={50} animated={true} />);
      
      const progressCircle = document.querySelector('.progress-foreground');
      expect(progressCircle).toHaveClass('animated');
    });

    it('does not apply animated class when animated is false', () => {
      render(<CircularProgress percentage={50} animated={false} />);
      
      const progressCircle = document.querySelector('.progress-foreground');
      expect(progressCircle).not.toHaveClass('animated');
    });

    it('applies animated class by default', () => {
      render(<CircularProgress percentage={50} />);
      
      const progressCircle = document.querySelector('.progress-foreground');
      expect(progressCircle).toHaveClass('animated');
    });

    it('applies correct transition style when animated', () => {
      render(<CircularProgress percentage={50} animated={true} />);
      
      const progressCircle = document.querySelector('.progress-foreground') as HTMLElement;
      expect(progressCircle.style.transition).toBe('stroke-dashoffset 0.5s ease-in-out');
    });

    it('applies no transition when not animated', () => {
      render(<CircularProgress percentage={50} animated={false} />);
      
      const progressCircle = document.querySelector('.progress-foreground') as HTMLElement;
      expect(progressCircle.style.transition).toBe('none');
    });
  });

  describe('Children Content', () => {
    it('renders children when provided', () => {
      const childContent = <div data-testid="child-content">75%</div>;
      render(<CircularProgress percentage={75}>{childContent}</CircularProgress>);
      
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('does not render content container when no children', () => {
      render(<CircularProgress percentage={50} />);
      
      const contentContainer = document.querySelector('.circular-progress-content');
      expect(contentContainer).not.toBeInTheDocument();
    });

    it('positions children content correctly', () => {
      render(
        <CircularProgress percentage={50}>
          <span data-testid="centered-content">Centered</span>
        </CircularProgress>
      );
      
      const contentContainer = document.querySelector('.circular-progress-content') as HTMLElement;
      expect(contentContainer).toHaveStyle({
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)'
      });
    });
  });

  describe('SVG Structure', () => {
    it('creates correct SVG structure', () => {
      render(<CircularProgress percentage={50} size={100} strokeWidth={6} />);
      
      const svg = document.querySelector('svg');
      expect(svg).toHaveClass('circular-progress-svg');
      
      const circles = svg.querySelectorAll('circle');
      expect(circles).toHaveLength(2);
      
      const [background, foreground] = circles;
      expect(background).toHaveClass('progress-background');
      expect(foreground).toHaveClass('progress-foreground');
    });

    it('sets correct circle attributes', () => {
      const size = 100;
      const strokeWidth = 6;
      const radius = (size - strokeWidth) / 2;
      
      render(<CircularProgress percentage={50} size={size} strokeWidth={strokeWidth} />);
      
      const circles = document.querySelectorAll('circle');
      const [background, foreground] = circles;
      
      // Both circles should have same basic attributes
      [background, foreground].forEach(circle => {
        expect(circle).toHaveAttribute('cx', (size / 2).toString());
        expect(circle).toHaveAttribute('cy', (size / 2).toString());
        expect(circle).toHaveAttribute('r', radius.toString());
        expect(circle).toHaveAttribute('stroke-width', strokeWidth.toString());
        expect(circle).toHaveAttribute('fill', 'transparent');
      });
    });

    it('applies correct transform to progress circle', () => {
      render(<CircularProgress percentage={50} />);
      
      const progressCircle = document.querySelector('.progress-foreground') as HTMLElement;
      expect(progressCircle.style.transform).toBe('rotate(-90deg)');
      expect(progressCircle.style.transformOrigin).toBe('50% 50%');
    });

    it('sets stroke-linecap to round for progress circle', () => {
      render(<CircularProgress percentage={50} />);
      
      const progressCircle = document.querySelector('.progress-foreground');
      expect(progressCircle).toHaveAttribute('stroke-linecap', 'round');
    });
  });

  describe('Container Styling', () => {
    it('sets correct container dimensions', () => {
      const size = 150;
      render(<CircularProgress percentage={50} size={size} />);
      
      const container = document.querySelector('.circular-progress') as HTMLElement;
      expect(container.style.width).toBe(`${size}px`);
      expect(container.style.height).toBe(`${size}px`);
    });

    it('has container element', () => {
      render(<CircularProgress percentage={50} />);
      
      const container = document.querySelector('.circular-progress');
      expect(container).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('provides meaningful structure for screen readers', () => {
      render(
        <CircularProgress percentage={75}>
          <div>75% complete</div>
        </CircularProgress>
      );
      
      // SVG should be present
      const svg = document.querySelector('svg');
      expect(svg).toBeInTheDocument();
      
      // Content should be accessible
      expect(screen.getByText('75% complete')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles very small sizes', () => {
      render(<CircularProgress percentage={50} size={20} strokeWidth={2} />);
      
      const svg = document.querySelector('svg');
      expect(svg).toHaveAttribute('width', '20');
      expect(svg).toHaveAttribute('height', '20');
      
      const radius = (20 - 2) / 2; // 9
      const circles = svg!.querySelectorAll('circle');
      expect(circles[0]).toHaveAttribute('r', radius.toString());
    });

    it('handles stroke width larger than radius gracefully', () => {
      render(<CircularProgress percentage={50} size={50} strokeWidth={30} />);
      
      const radius = (50 - 30) / 2; // 10
      const circles = document.querySelectorAll('circle');
      expect(circles[0]).toHaveAttribute('r', radius.toString());
    });

    it('handles floating point percentages', () => {
      render(<CircularProgress percentage={33.333} size={120} strokeWidth={8} />);
      
      const progressCircle = document.querySelector('.progress-foreground');
      const radius = (120 - 8) / 2;
      const circumference = radius * 2 * Math.PI;
      const expectedOffset = circumference - (33.333 / 100) * circumference;
      
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', expectedOffset.toString());
    });
  });
});