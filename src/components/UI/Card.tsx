import React, { forwardRef, ReactNode, HTMLAttributes } from 'react';
import styles from '../../styles/components/Card.module.css';

// Base Card Props
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  variant?: 'default' | 'goal' | 'run' | 'template';
  children: ReactNode;
  completed?: boolean;
  interactive?: boolean;
  loading?: boolean;
  className?: string;
}

// Card Header Props
export interface CardHeaderProps {
  children: ReactNode;
  variant?: 'default' | 'template' | 'run';
  className?: string;
}

// Card Icon Props
export interface CardIconProps {
  children: ReactNode;
  variant?: 'default' | 'template';
  color?: string;
  className?: string;
}

// Card Title Props
export interface CardTitleProps {
  children: ReactNode;
  variant?: 'default' | 'template';
  className?: string;
}

// Card Description Props
export interface CardDescriptionProps {
  children: ReactNode;
  variant?: 'default' | 'template';
  className?: string;
}

// Card Actions Props
export interface CardActionsProps {
  children: ReactNode;
  variant?: 'default' | 'run' | 'template';
  className?: string;
}

// Card Content Props
export interface CardContentProps {
  children: ReactNode;
  className?: string;
}

// Card Footer Props
export interface CardFooterProps {
  children: ReactNode;
  className?: string;
}

// Progress Props
export interface CardProgressProps {
  children: ReactNode;
  className?: string;
}

// Icon Button Props
export interface IconButtonProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'className'> {
  children: ReactNode;
  variant?: 'default' | 'run' | 'delete' | 'edit';
  title?: string;
  className?: string;
  onClick?: () => void;
}

// Expand Controls Props
export interface ExpandControlsProps {
  isExpanded: boolean;
  onToggle: () => void;
  expandText?: string;
  collapseText?: string;
  className?: string;
}

// Expanded Content Props
export interface ExpandedContentProps {
  children: ReactNode;
  className?: string;
}

// Base Card Component
export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = 'default',
      children,
      completed = false,
      interactive = false,
      loading = false,
      className = '',
      ...props
    },
    ref
  ) => {
    const variantClasses: Record<string, string> = {
      goal: styles.cardGoal,
      run: styles.cardRun,
      template: styles.cardTemplate,
    };

    const getCardClasses = () => {
      return [
        styles.card,
        variantClasses[variant],
        completed && styles.cardCompleted,
        interactive && styles.cardInteractive,
        loading && styles.cardLoading,
        className,
      ]
        .filter(Boolean)
        .join(' ');
    };

    // Check if card contains interactive elements to avoid nested interactive violation
    const shouldHaveButtonRole = interactive;

    const { onKeyDown: propsOnKeyDown, ...restProps } = props;

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (shouldHaveButtonRole && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        props.onClick?.(event as unknown as React.MouseEvent<HTMLDivElement>);
      }
      propsOnKeyDown?.(event);
    };

    return (
      <div
        ref={ref}
        className={getCardClasses()}
        {...restProps}
        role={shouldHaveButtonRole ? 'button' : undefined}
        tabIndex={shouldHaveButtonRole ? 0 : undefined}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

// Card Header Component
export const CardHeader: React.FC<CardHeaderProps> = ({
  children,
  variant = 'default',
  className = '',
}) => {
  const headerVariantClasses: Record<string, string> = {
    template: styles.cardHeaderTemplate,
    run: styles.cardHeaderRun,
  };

  const getHeaderClasses = () => {
    return [styles.cardHeader, headerVariantClasses[variant], className].filter(Boolean).join(' ');
  };
  return <div className={getHeaderClasses()}>{children}</div>;
};

// Card Icon Component
export const CardIcon: React.FC<CardIconProps> = ({
  children,
  variant = 'default',
  color,
  className = '',
}) => {
  const getIconClasses = () => {
    return [styles.cardIcon, variant === 'template' && styles.cardIconTemplate, className]
      .filter(Boolean)
      .join(' ');
  };

  return (
    <div className={getIconClasses()} style={color ? { color } : undefined}>
      {children}
    </div>
  );
};

// Card Title Component
export const CardTitle: React.FC<CardTitleProps> = ({
  children,
  variant = 'default',
  className = '',
}) => {
  const getTitleClasses = () => {
    return [styles.cardTitle, variant === 'template' && styles.cardTitleTemplate, className]
      .filter(Boolean)
      .join(' ');
  };

  return <div className={getTitleClasses()}>{children}</div>;
};

// Card Description Component
export const CardDescription: React.FC<CardDescriptionProps> = ({
  children,
  variant = 'default',
  className = '',
}) => {
  const getDescriptionClasses = () => {
    return [
      styles.cardDescription,
      variant === 'template' && styles.cardDescriptionTemplate,
      className,
    ]
      .filter(Boolean)
      .join(' ');
  };

  return <p className={getDescriptionClasses()}>{children}</p>;
};

// Card Actions Component
export const CardActions: React.FC<CardActionsProps> = ({
  children,
  variant = 'default',
  className = '',
}) => {
  const actionsVariantClasses: Record<string, string> = {
    run: styles.cardActionsRun,
    template: styles.cardActionsTemplate,
  };

  const getActionsClasses = () => {
    return [styles.cardActions, actionsVariantClasses[variant], className]
      .filter(Boolean)
      .join(' ');
  };
  return <div className={getActionsClasses()}>{children}</div>;
};

// Card Content Component
export const CardContent: React.FC<CardContentProps> = ({ children, className = '' }) => {
  return <div className={`${styles.cardContent} ${className}`}>{children}</div>;
};

// Card Footer Component
export const CardFooter: React.FC<CardFooterProps> = ({ children, className = '' }) => {
  return <div className={`${styles.cardFooter} ${className}`}>{children}</div>;
};

// Card Progress Component
export const CardProgress: React.FC<CardProgressProps> = ({ children, className = '' }) => {
  return <div className={`${styles.cardProgress} ${className}`}>{children}</div>;
};

// Icon Button Component
export const IconButton: React.FC<IconButtonProps> = ({
  children,
  variant = 'default',
  title,
  className = '',
  onClick,
  ...props
}) => {
  const buttonVariantClasses: Record<string, string> = {
    run: styles.iconBtnRun,
    delete: styles.iconBtnDelete,
    edit: styles.iconBtnEdit,
  };

  const getButtonClasses = () => {
    const baseClass = variant === 'run' ? styles.iconBtnRun : styles.iconBtn;
    const variantClass = variant !== 'run' ? buttonVariantClasses[variant] : undefined;
    return [baseClass, variantClass, className].filter(Boolean).join(' ');
  };

  return (
    <button className={getButtonClasses()} title={title} onClick={onClick} {...props}>
      {children}
    </button>
  );
};

// Expand Controls Component
export const ExpandControls: React.FC<ExpandControlsProps> = ({
  isExpanded,
  onToggle,
  expandText = 'View details',
  collapseText = 'Show less',
  className = '',
}) => {
  return (
    <div className={`${styles.expandControls} ${className}`}>
      <button
        className={styles.expandBtn}
        onClick={onToggle}
        title={isExpanded ? collapseText : expandText}
      >
        <span>{isExpanded ? collapseText : expandText}</span>
        <span className={`${styles.expandIcon} ${isExpanded ? styles.expandIconExpanded : ''}`}>
          ▼
        </span>
      </button>
    </div>
  );
};

// Expanded Content Component
export const ExpandedContent: React.FC<ExpandedContentProps> = ({ children, className = '' }) => {
  return <div className={`${styles.expandedContent} ${className}`}>{children}</div>;
};

// Progress Components
export interface ProgressHeaderProps {
  children: ReactNode;
  className?: string;
}

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  percentage: number;
  completed?: boolean;
  color?: string;
  className?: string;
}

export interface DetailedProgressProps {
  children: ReactNode;
  className?: string;
}

export interface SimpleProgressProps {
  children: ReactNode;
  className?: string;
}

export const ProgressHeader: React.FC<ProgressHeaderProps> = ({ children, className = '' }) => {
  return <div className={`${styles.progressHeader} ${className}`}>{children}</div>;
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  percentage,
  completed = false,
  color,
  className = '',
  ...props
}) => {
  const fillClasses = [styles.progressFill];
  if (completed) fillClasses.push(styles.progressFillCompleted);

  const normalizedPercentage = Math.max(0, Math.min(percentage, 100));

  return (
    <div
      className={`${styles.progressBar} ${className}`}
      role='progressbar'
      aria-valuenow={normalizedPercentage}
      aria-valuemin={0}
      aria-valuemax={100}
      {...props}
    >
      <div
        className={fillClasses.join(' ')}
        style={{
          transform: `scaleX(${normalizedPercentage / 100})`,
          backgroundColor: color || undefined,
        }}
      />
    </div>
  );
};

export const DetailedProgress: React.FC<DetailedProgressProps> = ({ children, className = '' }) => {
  return <div className={`${styles.detailedProgress} ${className}`}>{children}</div>;
};

export const SimpleProgress: React.FC<SimpleProgressProps> = ({ children, className = '' }) => {
  return <div className={`${styles.simpleProgress} ${className}`}>{children}</div>;
};

// Utility Components for specific content types
export interface CompletionBadgeProps {
  children: ReactNode;
  className?: string;
}

export interface DifficultyBadgeProps {
  difficulty: string;
  className?: string;
}

export const CompletionBadge: React.FC<CompletionBadgeProps> = ({ children, className = '' }) => {
  return <div className={`${styles.completionBadge} ${className}`}>{children}</div>;
};

export const DifficultyBadge: React.FC<DifficultyBadgeProps> = ({ difficulty, className = '' }) => {
  const colorMap: Record<string, string> = {
    beginner: '#10b981',
    intermediate: '#f59e0b',
    advanced: '#ef4444',
  };

  const getColor = (level: string) => {
    return colorMap[level] || '#6b7280';
  };

  return (
    <span
      className={`${styles.difficultyBadge} ${className}`}
      style={{ backgroundColor: getColor(difficulty) }}
    >
      {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
    </span>
  );
};

// Export all components
export default Card;
