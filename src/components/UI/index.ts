/**
 * UI Component Library
 *
 * Central export point for all reusable UI components.
 * These components use CSS modules for styling and provide
 * consistent theming and accessibility features.
 */

// Button components
export { Button, ButtonGroup, IconButton } from './Button';
export type { ButtonProps, ButtonGroupProps, IconButtonProps } from './Button';

// Input components
export { Input, InputGroup, TextArea } from './Input';
export type { InputProps, InputGroupProps, TextAreaProps } from './Input';

// Modal components
export { Modal, ConfirmationModal, LoadingModal } from './Modal';
export type { ModalProps, ConfirmationModalProps, LoadingModalProps } from './Modal';

// Card components
export {
  Card,
  CardHeader,
  CardIcon,
  CardTitle,
  CardDescription,
  CardContent,
  CardActions,
  CardFooter,
  CardProgress,
  IconButton as CardIconButton,
  ExpandControls,
  ExpandedContent,
  ProgressHeader,
  ProgressBar,
  DetailedProgress,
  SimpleProgress,
  CompletionBadge,
  DifficultyBadge,
} from './Card';
export type {
  CardProps,
  CardHeaderProps,
  CardIconProps,
  CardTitleProps,
  CardDescriptionProps,
  CardContentProps,
  CardActionsProps,
  CardFooterProps,
  CardProgressProps,
  IconButtonProps as CardIconButtonProps,
  ExpandControlsProps,
  ExpandedContentProps,
  ProgressHeaderProps,
  ProgressBarProps,
  DetailedProgressProps,
  SimpleProgressProps,
  CompletionBadgeProps,
  DifficultyBadgeProps,
} from './Card';
