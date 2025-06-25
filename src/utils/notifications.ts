import {
  BrowserNotificationOptions,
  NotificationPreferences,
  GoalNotification,
} from '../types/notifications';

// Browser Notification Permission Management
export class NotificationPermissionManager {
  static async requestPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      console.warn('Browser does not support notifications');
      return 'denied';
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission === 'denied') {
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();
      return permission;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return 'denied';
    }
  }

  static hasPermission(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  static canRequestPermission(): boolean {
    return 'Notification' in window && Notification.permission === 'default';
  }
}

// Browser Notification Utilities
export class BrowserNotificationManager {
  private static activeNotifications = new Map<string, Notification>();

  static async show(
    options: BrowserNotificationOptions,
    tag?: string
  ): Promise<Notification | null> {
    if (!NotificationPermissionManager.hasPermission()) {
      console.warn('No notification permission');
      return null;
    }

    try {
      // Close existing notification with same tag
      if (tag && this.activeNotifications.has(tag)) {
        this.activeNotifications.get(tag)?.close();
      }

      const notification = new Notification(options.title, {
        body: options.body,
        icon: options.icon || '/favicon.ico',
        badge: options.badge || '/favicon.ico',
        tag: tag || `notification-${Date.now()}`,
        requireInteraction: options.requireInteraction || false,
        silent: options.silent || false,
        // actions: options.actions || [], // Actions not widely supported
      });

      // Store reference
      if (tag) {
        this.activeNotifications.set(tag, notification);
      }

      // Auto-close after 8 seconds if not requiring interaction
      if (!options.requireInteraction) {
        setTimeout(() => {
          notification.close();
          if (tag) {
            this.activeNotifications.delete(tag);
          }
        }, 8000);
      }

      // Clean up on close
      notification.onclose = () => {
        if (tag) {
          this.activeNotifications.delete(tag);
        }
      };

      return notification;
    } catch (error) {
      console.error('Error showing notification:', error);
      return null;
    }
  }

  static closeNotification(tag: string): void {
    const notification = this.activeNotifications.get(tag);
    if (notification) {
      notification.close();
      this.activeNotifications.delete(tag);
    }
  }

  static closeAllNotifications(): void {
    this.activeNotifications.forEach(notification => notification.close());
    this.activeNotifications.clear();
  }
}

// Notification Timing Utilities
export class NotificationTimingManager {
  static isWithinQuietHours(preferences: NotificationPreferences): boolean {
    if (!preferences.quietHours.enabled) {
      return false;
    }

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const { start, end } = preferences.quietHours;

    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (start > end) {
      return currentTime >= start || currentTime <= end;
    }

    // Handle same-day quiet hours (e.g., 12:00 to 14:00)
    return currentTime >= start && currentTime <= end;
  }

  static shouldShowNotification(
    notification: GoalNotification,
    preferences: NotificationPreferences
  ): boolean {
    // Check if notification type is enabled
    switch (notification.type) {
      case 'milestone':
        if (!preferences.enableMilestoneNotifications) return false;
        break;
      case 'deadline':
        if (!preferences.enableDeadlineReminders) return false;
        break;
      case 'streak':
        if (!preferences.enableStreakNotifications) return false;
        break;
      case 'summary':
        if (!preferences.enableSummaryNotifications) return false;
        break;
      case 'reminder':
        if (!preferences.enableReminderNotifications) return false;
        break;
    }

    // Check quiet hours for non-urgent notifications
    if (notification.priority !== 'urgent' && this.isWithinQuietHours(preferences)) {
      return false;
    }

    return true;
  }

  static getOptimalNotificationTime(
    preferences: NotificationPreferences,
    type: 'morning' | 'evening'
  ): Date {
    const now = new Date();
    const targetTime = preferences.reminderTimes[type];
    const [hours, minutes] = targetTime.split(':').map(Number);

    const notificationTime = new Date(now);
    notificationTime.setHours(hours, minutes, 0, 0);

    // If the time has passed today, schedule for tomorrow
    if (notificationTime <= now) {
      notificationTime.setDate(notificationTime.getDate() + 1);
    }

    return notificationTime;
  }
}

// Notification Content Generation
export class NotificationContentGenerator {
  static generateMilestoneContent(
    goalTitle: string,
    percentage: number,
    currentProgress: number,
    targetValue: number,
    unit: string
  ): { title: string; message: string; icon: string } {
    const milestoneEmojis = {
      25: '🌟',
      50: '⭐',
      75: '🔥',
      100: '🏆',
    };

    const emoji = milestoneEmojis[percentage as keyof typeof milestoneEmojis] || '📈';

    return {
      title: `${percentage}% Complete! ${emoji}`,
      message: `You've reached ${percentage}% of your "${goalTitle}" goal! ${currentProgress}/${targetValue} ${unit} completed.`,
      icon: emoji,
    };
  }

  static generateDeadlineContent(
    goalTitle: string,
    daysRemaining: number,
    currentProgress: number,
    targetValue: number,
    unit: string
  ): { title: string; message: string; icon: string } {
    let title: string;
    let icon: string;

    if (daysRemaining === 0) {
      title = '⏰ Goal Deadline Today!';
      icon = '⏰';
    } else if (daysRemaining === 1) {
      title = '📅 Goal Ends Tomorrow';
      icon = '📅';
    } else if (daysRemaining <= 3) {
      title = `⚠️ ${daysRemaining} Days Left`;
      icon = '⚠️';
    } else {
      title = `📋 ${daysRemaining} Days Remaining`;
      icon = '📋';
    }

    const progressPercentage = Math.round((currentProgress / targetValue) * 100);
    const message = `"${goalTitle}" - ${progressPercentage}% complete (${currentProgress}/${targetValue} ${unit}). Keep pushing!`;

    return { title, message, icon };
  }

  static generateStreakContent(
    streakCount: number,
    streakType: string,
    goalTitle?: string
  ): { title: string; message: string; icon: string } {
    const streakEmojis = {
      3: '🔥',
      7: '⚡',
      14: '💪',
      21: '🏃‍♂️',
      30: '🏆',
    };

    const getClosestEmoji = (count: number) => {
      const levels = Object.keys(streakEmojis)
        .map(Number)
        .sort((a, b) => a - b);
      for (let i = levels.length - 1; i >= 0; i--) {
        if (count >= levels[i]) {
          return streakEmojis[levels[i] as keyof typeof streakEmojis];
        }
      }
      return '🔥';
    };

    const emoji = getClosestEmoji(streakCount);
    const typeLabel = streakType === 'daily' ? 'day' : streakType === 'weekly' ? 'week' : 'month';
    const plural = streakCount > 1 ? `${typeLabel}s` : typeLabel;

    const title = `${emoji} ${streakCount} ${plural.charAt(0).toUpperCase() + plural.slice(1)} Streak!`;
    let message = `Amazing consistency! You've maintained your running streak for ${streakCount} ${plural}.`;

    if (goalTitle) {
      message += ` Keep it up with "${goalTitle}"!`;
    }

    return { title, message, icon: emoji };
  }

  static generateSummaryContent(
    period: 'weekly' | 'monthly',
    goalsCompleted: number,
    totalGoals: number,
    averageProgress: number,
    topPerformingGoal?: string
  ): { title: string; message: string; icon: string } {
    const periodLabel = period === 'weekly' ? 'Week' : 'Month';
    const completionRate = totalGoals > 0 ? Math.round((goalsCompleted / totalGoals) * 100) : 0;

    const title = `📊 ${periodLabel} Summary`;
    let message = `${goalsCompleted}/${totalGoals} goals completed (${completionRate}%). Average progress: ${Math.round(averageProgress)}%.`;

    if (topPerformingGoal) {
      message += ` Top performer: "${topPerformingGoal}".`;
    }

    return {
      title,
      message,
      icon: '📊',
    };
  }

  static generateReminderContent(reminderType: string): {
    title: string;
    message: string;
    icon: string;
  } {
    const reminders = {
      goal_check_in: {
        title: '🎯 Goal Check-in Time',
        message: 'How are your running goals progressing? Log a run or review your targets.',
        icon: '🎯',
      },
      missed_run: {
        title: "🏃‍♂️ Haven't seen you lately",
        message: "It's been a while since your last run. Every step counts toward your goals!",
        icon: '🏃‍♂️',
      },
      weekly_planning: {
        title: '📅 Weekly Goal Planning',
        message: 'Time to plan your running week! Set or adjust your goals for maximum success.',
        icon: '📅',
      },
    };

    return (
      reminders[reminderType as keyof typeof reminders] || {
        title: '💭 Reminder',
        message: "Don't forget about your running goals!",
        icon: '💭',
      }
    );
  }
}

// Default notification preferences
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enableBrowserNotifications: false,
  enableMilestoneNotifications: true,
  enableDeadlineReminders: true,
  enableStreakNotifications: true,
  enableSummaryNotifications: true,
  enableReminderNotifications: false,
  deadlineReminderDays: [7, 3, 1],
  reminderTimes: {
    morning: '08:00',
    evening: '18:00',
  },
  summaryFrequency: 'weekly',
  enableSounds: true,
  quietHours: {
    enabled: true,
    start: '22:00',
    end: '08:00',
  },
};

// Storage utilities for notification preferences
export class NotificationPreferencesStorage {
  private static readonly STORAGE_KEY = 'goalNotificationPreferences';

  static save(preferences: NotificationPreferences): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {
      console.error('Failed to save notification preferences:', error);
    }
  }

  static load(): NotificationPreferences {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle new preference fields
        return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...parsed };
      }
    } catch (error) {
      console.error('Failed to load notification preferences:', error);
    }
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  static clear(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear notification preferences:', error);
    }
  }
}
