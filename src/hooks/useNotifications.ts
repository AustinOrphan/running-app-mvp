import { useState, useCallback, useEffect } from 'react';

import { Goal, GoalProgress } from '../types/goals';
import {
  GoalNotification,
  NotificationPreferences,
  MilestoneNotification,
  DeadlineNotification,
  StreakNotification,
  SummaryNotification,
  ReminderNotification,
} from '../types/notifications';
import {
  NotificationPermissionManager,
  BrowserNotificationManager,
  NotificationTimingManager,
  NotificationContentGenerator,
  NotificationPreferencesStorage,
} from '../utils/notifications';
import { logError } from '../utils/clientLogger';

import { useToast } from './useToast';

interface UseNotificationsReturn {
  notifications: GoalNotification[];
  preferences: NotificationPreferences;
  hasPermission: boolean;
  canRequestPermission: boolean;
  requestPermission: () => Promise<boolean>;
  updatePreferences: (newPreferences: Partial<NotificationPreferences>) => void;
  showMilestoneNotification: (goal: Goal, progress: GoalProgress, milestone: number) => void;
  showDeadlineNotification: (goal: Goal, progress: GoalProgress) => void;
  showStreakNotification: (
    streakCount: number,
    streakType: 'daily' | 'weekly' | 'monthly',
    goalTitle?: string
  ) => void;
  showSummaryNotification: (
    period: 'weekly' | 'monthly',
    stats: {
      goalsCompleted: number;
      totalGoals: number;
      averageProgress: number;
      topPerformingGoal?: string;
    }
  ) => void;
  showReminderNotification: (
    reminderType: 'goal_check_in' | 'missed_run' | 'weekly_planning'
  ) => void;
  dismissNotification: (notificationId: string) => void;
  markAsRead: (notificationId: string) => void;
  clearAllNotifications: () => void;
  getUnreadCount: () => number;
}

export const useNotifications = (): UseNotificationsReturn => {
  const [notifications, setNotifications] = useState<GoalNotification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    NotificationPreferencesStorage.load()
  );
  const [hasPermission, setHasPermission] = useState(NotificationPermissionManager.hasPermission());
  const [canRequestPermission, setCanRequestPermission] = useState(
    NotificationPermissionManager.canRequestPermission()
  );

  const { showToast } = useToast();

  // Load notifications from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('goalNotifications');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setNotifications(parsed);
      } catch (error) {
        logError(
          'Failed to load notifications',
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }, []);

  // Save notifications to localStorage when they change
  useEffect(() => {
    try {
      localStorage.setItem('goalNotifications', JSON.stringify(notifications));
    } catch (error) {
      logError(
        'Failed to save notifications',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }, [notifications]);

  // Update preferences and save to storage
  const updatePreferences = useCallback(
    (newPreferences: Partial<NotificationPreferences>) => {
      const updatedPreferences = { ...preferences, ...newPreferences };
      setPreferences(updatedPreferences);
      NotificationPreferencesStorage.save(updatedPreferences);
    },
    [preferences]
  );

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    const permission = await NotificationPermissionManager.requestPermission();
    const granted = permission === 'granted';
    setHasPermission(granted);
    setCanRequestPermission(permission === 'default');

    if (granted) {
      updatePreferences({ enableBrowserNotifications: true });
      showToast('Notifications enabled successfully!', 'success');
    } else {
      showToast(
        'Notification permission denied. You can still receive in-app notifications.',
        'info'
      );
    }

    return granted;
  }, [updatePreferences, showToast]);

  // Add notification to queue and process
  const addNotification = useCallback(
    (notification: GoalNotification) => {
      // Check if notification should be shown based on preferences
      if (!NotificationTimingManager.shouldShowNotification(notification, preferences)) {
        return;
      }

      // Add to internal notification list
      setNotifications(prev => {
        const updated = [notification, ...prev];
        // Keep only the most recent 50 notifications
        return updated.slice(0, 50);
      });

      // Show toast notification
      const toastType =
        notification.priority === 'urgent'
          ? 'error'
          : notification.priority === 'high'
            ? 'info'
            : 'success';
      showToast(`${notification.icon || ''} ${notification.title}`, toastType);

      // Show browser notification if enabled and permission granted
      if (preferences.enableBrowserNotifications && hasPermission) {
        BrowserNotificationManager.show(
          {
            title: notification.title,
            body: notification.message,
            icon: '/favicon.ico',
            requireInteraction: notification.priority === 'urgent',
            silent: !preferences.enableSounds,
          },
          `goal-${notification.type}-${notification.goalId || 'general'}`
        );
      }
    },
    [preferences, hasPermission, showToast]
  );

  // Generate notification ID
  const generateNotificationId = useCallback(() => {
    return `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Milestone notification
  const showMilestoneNotification = useCallback(
    (goal: Goal, progress: GoalProgress, milestone: number) => {
      const content = NotificationContentGenerator.generateMilestoneContent(
        goal.title,
        milestone,
        progress.currentValue,
        goal.targetValue,
        goal.targetUnit
      );

      const notification: MilestoneNotification = {
        id: generateNotificationId(),
        type: 'milestone',
        priority: milestone >= 75 ? 'high' : 'medium',
        title: content.title,
        message: content.message,
        timestamp: new Date(),
        read: false,
        dismissed: false,
        goalId: goal.id,
        icon: content.icon,
        color: goal.color || '#3b82f6',
        milestonePercentage: milestone,
        currentProgress: progress.currentValue,
        targetValue: goal.targetValue,
        goalTitle: goal.title,
      };

      addNotification(notification);
    },
    [generateNotificationId, addNotification]
  );

  // Deadline notification
  const showDeadlineNotification = useCallback(
    (goal: Goal, progress: GoalProgress) => {
      const content = NotificationContentGenerator.generateDeadlineContent(
        goal.title,
        progress.daysRemaining,
        progress.currentValue,
        goal.targetValue,
        goal.targetUnit
      );

      const notification: DeadlineNotification = {
        id: generateNotificationId(),
        type: 'deadline',
        priority:
          progress.daysRemaining <= 1 ? 'urgent' : progress.daysRemaining <= 3 ? 'high' : 'medium',
        title: content.title,
        message: content.message,
        timestamp: new Date(),
        read: false,
        dismissed: false,
        goalId: goal.id,
        icon: content.icon,
        color: progress.daysRemaining <= 1 ? '#ef4444' : '#f59e0b',
        daysRemaining: progress.daysRemaining,
        goalTitle: goal.title,
        goalEndDate: new Date(goal.endDate),
        currentProgress: progress.currentValue,
        targetValue: goal.targetValue,
      };

      addNotification(notification);
    },
    [generateNotificationId, addNotification]
  );

  // Streak notification
  const showStreakNotification = useCallback(
    (streakCount: number, streakType: 'daily' | 'weekly' | 'monthly', goalTitle?: string) => {
      const content = NotificationContentGenerator.generateStreakContent(
        streakCount,
        streakType,
        goalTitle
      );

      const notification: StreakNotification = {
        id: generateNotificationId(),
        type: 'streak',
        priority: streakCount >= 30 ? 'high' : 'medium',
        title: content.title,
        message: content.message,
        timestamp: new Date(),
        read: false,
        dismissed: false,
        icon: content.icon,
        color: '#10b981',
        streakCount,
        streakType,
        goalTitle,
      };

      addNotification(notification);
    },
    [generateNotificationId, addNotification]
  );

  // Summary notification
  const showSummaryNotification = useCallback(
    (
      period: 'weekly' | 'monthly',
      stats: {
        goalsCompleted: number;
        totalGoals: number;
        averageProgress: number;
        topPerformingGoal?: string;
      }
    ) => {
      const content = NotificationContentGenerator.generateSummaryContent(
        period,
        stats.goalsCompleted,
        stats.totalGoals,
        stats.averageProgress,
        stats.topPerformingGoal
      );

      const notification: SummaryNotification = {
        id: generateNotificationId(),
        type: 'summary',
        priority: 'low',
        title: content.title,
        message: content.message,
        timestamp: new Date(),
        read: false,
        dismissed: false,
        icon: content.icon,
        color: '#6366f1',
        summaryPeriod: period,
        goalsCompleted: stats.goalsCompleted,
        totalGoals: stats.totalGoals,
        averageProgress: stats.averageProgress,
        topPerformingGoal: stats.topPerformingGoal,
      };

      addNotification(notification);
    },
    [generateNotificationId, addNotification]
  );

  // Reminder notification
  const showReminderNotification = useCallback(
    (reminderType: 'goal_check_in' | 'missed_run' | 'weekly_planning') => {
      const content = NotificationContentGenerator.generateReminderContent(reminderType);

      const notification: ReminderNotification = {
        id: generateNotificationId(),
        type: 'reminder',
        priority: 'low',
        title: content.title,
        message: content.message,
        timestamp: new Date(),
        read: false,
        dismissed: false,
        icon: content.icon,
        color: '#8b5cf6',
        reminderType,
        scheduledFor: new Date(),
      };

      addNotification(notification);
    },
    [generateNotificationId, addNotification]
  );

  // Dismiss notification
  const dismissNotification = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(notification =>
        notification.id === notificationId ? { ...notification, dismissed: true } : notification
      )
    );
  }, []);

  // Mark notification as read
  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(notification =>
        notification.id === notificationId ? { ...notification, read: true } : notification
      )
    );
  }, []);

  // Clear all notifications
  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
    BrowserNotificationManager.closeAllNotifications();
  }, []);

  // Get unread notification count
  const getUnreadCount = useCallback((): number => {
    return notifications.filter(n => !n.read && !n.dismissed).length;
  }, [notifications]);

  return {
    notifications: notifications.filter(n => !n.dismissed),
    preferences,
    hasPermission,
    canRequestPermission,
    requestPermission,
    updatePreferences,
    showMilestoneNotification,
    showDeadlineNotification,
    showStreakNotification,
    showSummaryNotification,
    showReminderNotification,
    dismissNotification,
    markAsRead,
    clearAllNotifications,
    getUnreadCount,
  };
};
