export type NotificationType =
  | 'achievement'
  | 'milestone'
  | 'deadline'
  | 'streak'
  | 'summary'
  | 'reminder';

export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface BaseNotification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  dismissed: boolean;
  goalId?: string;
  actionUrl?: string;
  icon?: string;
  color?: string;
}

export interface MilestoneNotification extends BaseNotification {
  type: 'milestone';
  milestonePercentage: number;
  currentProgress: number;
  targetValue: number;
  goalTitle: string;
}

export interface DeadlineNotification extends BaseNotification {
  type: 'deadline';
  daysRemaining: number;
  goalTitle: string;
  goalEndDate: Date;
  currentProgress: number;
  targetValue: number;
}

export interface StreakNotification extends BaseNotification {
  type: 'streak';
  streakCount: number;
  streakType: 'daily' | 'weekly' | 'monthly';
  goalTitle?: string;
}

export interface SummaryNotification extends BaseNotification {
  type: 'summary';
  summaryPeriod: 'weekly' | 'monthly';
  goalsCompleted: number;
  totalGoals: number;
  averageProgress: number;
  topPerformingGoal?: string;
}

export interface ReminderNotification extends BaseNotification {
  type: 'reminder';
  reminderType: 'goal_check_in' | 'missed_run' | 'weekly_planning';
  scheduledFor: Date;
}

export type GoalNotification =
  | MilestoneNotification
  | DeadlineNotification
  | StreakNotification
  | SummaryNotification
  | ReminderNotification;

export interface NotificationPreferences {
  enableBrowserNotifications: boolean;
  enableMilestoneNotifications: boolean;
  enableDeadlineReminders: boolean;
  enableStreakNotifications: boolean;
  enableSummaryNotifications: boolean;
  enableReminderNotifications: boolean;
  deadlineReminderDays: number[]; // e.g., [7, 3, 1] for 7, 3, and 1 days before
  reminderTimes: {
    morning: string; // e.g., "08:00"
    evening: string; // e.g., "18:00"
  };
  summaryFrequency: 'weekly' | 'monthly' | 'both';
  enableSounds: boolean;
  quietHours: {
    enabled: boolean;
    start: string; // e.g., "22:00"
    end: string; // e.g., "08:00"
  };
}

export interface NotificationAction {
  id: string;
  label: string;
  action: () => void;
  primary?: boolean;
}

export interface NotificationQueue {
  notifications: GoalNotification[];
  maxSize: number;
  processing: boolean;
}

export interface BrowserNotificationOptions {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  silent?: boolean;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

export interface NotificationSchedule {
  id: string;
  goalId: string;
  type: NotificationType;
  scheduledFor: Date;
  executed: boolean;
  recurring?: {
    interval: 'daily' | 'weekly' | 'monthly';
    endDate?: Date;
  };
}
