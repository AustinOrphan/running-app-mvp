import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  NotificationPermissionManager,
  BrowserNotificationManager,
  NotificationTimingManager,
  NotificationContentGenerator,
  NotificationPreferencesStorage,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from '../../../src/utils/notifications';
import {
  NotificationPreferences,
  GoalNotification,
  BrowserNotificationOptions,
} from '../../../src/types/notifications';

// Mock Notification API
const mockNotification = vi.fn() as any;
const mockNotificationInstance = {
  close: vi.fn(),
  onclose: null as ((this: Notification, ev: Event) => any) | null,
  badge: '',
  body: '',
  data: null,
  dir: 'auto',
  icon: '',
  image: '',
  lang: '',
  onclick: null,
  onerror: null,
  onshow: null,
  requireInteraction: false,
  silent: false,
  tag: '',
  timestamp: Date.now(),
  title: '',
  vibrate: [],
  actions: [],
  maxActions: 2,
} as unknown as Notification;

// Set up Notification constructor and static properties
mockNotification.permission = 'default';
mockNotification.requestPermission = vi.fn();
mockNotification.mockReturnValue(mockNotificationInstance);

Object.defineProperty(global, 'Notification', {
  value: mockNotification,
  writable: true,
});

// Mock window object
Object.defineProperty(global, 'window', {
  value: {
    Notification: mockNotification,
  },
  writable: true,
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock clientLogger
vi.mock('../../../src/utils/clientLogger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// Helper functions
const createMockNotificationPreferences = (
  overrides: Partial<NotificationPreferences> = {}
): NotificationPreferences => ({
  ...DEFAULT_NOTIFICATION_PREFERENCES,
  ...overrides,
});

const createMockGoalNotification = (
  overrides: Partial<GoalNotification> = {}
): GoalNotification => {
  const base = {
    id: 'notification-1',
    type: 'milestone' as const,
    title: 'Test Notification',
    message: 'Test message',
    priority: 'medium' as const,
    goalId: 'goal-1',
    timestamp: new Date(),
    read: false,
    dismissed: false,
    milestonePercentage: 50,
    currentProgress: 25,
    targetValue: 50,
    goalTitle: 'Test Goal',
  };
  return { ...base, ...overrides } as GoalNotification;
};

describe('NotificationPermissionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotification.mockClear();

    // Reset Notification permission
    Object.defineProperty(mockNotification, 'permission', {
      value: 'default',
      writable: true,
    });

    mockNotification.requestPermission = vi.fn();
  });

  describe('requestPermission', () => {
    it('should return granted when already granted', async () => {
      mockNotification.permission = 'granted';

      const result = await NotificationPermissionManager.requestPermission();

      expect(result).toBe('granted');
      expect(mockNotification.requestPermission).not.toHaveBeenCalled();
    });

    it('should return denied when already denied', async () => {
      mockNotification.permission = 'denied';

      const result = await NotificationPermissionManager.requestPermission();

      expect(result).toBe('denied');
      expect(mockNotification.requestPermission).not.toHaveBeenCalled();
    });

    it('should request permission when default', async () => {
      mockNotification.permission = 'default';
      mockNotification.requestPermission.mockResolvedValue('granted');

      const result = await NotificationPermissionManager.requestPermission();

      expect(result).toBe('granted');
      expect(mockNotification.requestPermission).toHaveBeenCalled();
    });

    it('should handle permission request errors', async () => {
      mockNotification.permission = 'default';
      mockNotification.requestPermission.mockRejectedValue(new Error('Permission error'));

      const result = await NotificationPermissionManager.requestPermission();

      expect(result).toBe('denied');
    });

    it('should return denied when Notification is not supported', async () => {
      // Temporarily remove Notification
      const originalNotification = window.Notification;
      delete (window as any).Notification;

      const result = await NotificationPermissionManager.requestPermission();

      expect(result).toBe('denied');

      // Restore Notification
      window.Notification = originalNotification;
    });
  });

  describe('hasPermission', () => {
    it('should return true when permission is granted', () => {
      mockNotification.permission = 'granted';

      const result = NotificationPermissionManager.hasPermission();

      expect(result).toBe(true);
    });

    it('should return false when permission is denied', () => {
      mockNotification.permission = 'denied';

      const result = NotificationPermissionManager.hasPermission();

      expect(result).toBe(false);
    });

    it('should return false when permission is default', () => {
      mockNotification.permission = 'default';

      const result = NotificationPermissionManager.hasPermission();

      expect(result).toBe(false);
    });

    it('should return false when Notification is not supported', () => {
      const originalNotification = window.Notification;
      delete (window as any).Notification;

      const result = NotificationPermissionManager.hasPermission();

      expect(result).toBe(false);

      window.Notification = originalNotification;
    });
  });

  describe('canRequestPermission', () => {
    it('should return true when permission is default', () => {
      mockNotification.permission = 'default';

      const result = NotificationPermissionManager.canRequestPermission();

      expect(result).toBe(true);
    });

    it('should return false when permission is granted', () => {
      mockNotification.permission = 'granted';

      const result = NotificationPermissionManager.canRequestPermission();

      expect(result).toBe(false);
    });

    it('should return false when permission is denied', () => {
      mockNotification.permission = 'denied';

      const result = NotificationPermissionManager.canRequestPermission();

      expect(result).toBe(false);
    });
  });
});

describe('BrowserNotificationManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotification.mockClear();
    mockNotification.permission = 'granted';
    mockNotification.mockImplementation(() => mockNotificationInstance);

    // Clear active notifications
    BrowserNotificationManager.closeAllNotifications();

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('show', () => {
    const notificationOptions: BrowserNotificationOptions = {
      title: 'Test Title',
      body: 'Test body',
      icon: '/test-icon.png',
    };

    it('should create notification when permission granted', async () => {
      const result = await BrowserNotificationManager.show(notificationOptions);

      expect(mockNotification).toHaveBeenCalledWith('Test Title', {
        body: 'Test body',
        icon: '/test-icon.png',
        badge: '/favicon.ico',
        tag: expect.any(String),
        requireInteraction: false,
        silent: false,
      });
      expect(result).toBe(mockNotificationInstance);
    });

    it('should return null when no permission', async () => {
      mockNotification.permission = 'denied';

      const result = await BrowserNotificationManager.show(notificationOptions);

      expect(result).toBe(null);
      expect(mockNotification).not.toHaveBeenCalled();
    });

    it('should use custom tag when provided', async () => {
      await BrowserNotificationManager.show(notificationOptions, 'custom-tag');

      expect(mockNotification).toHaveBeenCalledWith('Test Title', {
        body: 'Test body',
        icon: '/test-icon.png',
        badge: '/favicon.ico',
        tag: 'custom-tag',
        requireInteraction: false,
        silent: false,
      });
    });

    it('should close existing notification with same tag', async () => {
      const existingNotification = { close: vi.fn() };
      mockNotification.mockReturnValueOnce(existingNotification);

      // Create first notification
      await BrowserNotificationManager.show(notificationOptions, 'same-tag');

      mockNotification.mockReturnValueOnce(mockNotificationInstance);

      // Create second notification with same tag
      await BrowserNotificationManager.show(notificationOptions, 'same-tag');

      expect(existingNotification.close).toHaveBeenCalled();
    });

    it('should auto-close notification after 8 seconds', async () => {
      await BrowserNotificationManager.show(notificationOptions);

      // Advance timers by 8 seconds
      vi.advanceTimersByTime(8000);

      expect(mockNotificationInstance.close).toHaveBeenCalled();
    });

    it('should not auto-close when requireInteraction is true', async () => {
      await BrowserNotificationManager.show({
        ...notificationOptions,
        requireInteraction: true,
      });

      vi.advanceTimersByTime(8000);

      expect(mockNotificationInstance.close).not.toHaveBeenCalled();
    });

    it('should handle notification creation errors', async () => {
      mockNotification.mockImplementation(() => {
        throw new Error('Notification creation failed');
      });

      const result = await BrowserNotificationManager.show(notificationOptions);

      expect(result).toBe(null);
    });

    it('should clean up on notification close', async () => {
      await BrowserNotificationManager.show(notificationOptions, 'test-tag');

      // Simulate notification close
      if (mockNotificationInstance.onclose) {
        mockNotificationInstance.onclose.call(mockNotificationInstance, new Event('close'));
      }

      // Tag should be removed from active notifications
      BrowserNotificationManager.closeNotification('test-tag');
      expect(mockNotificationInstance.close).not.toHaveBeenCalled(); // Already closed
    });

    it('should use default icon and badge when not provided', async () => {
      await BrowserNotificationManager.show({
        title: 'Test',
        body: 'Test body',
      });

      expect(mockNotification).toHaveBeenCalledWith('Test', {
        body: 'Test body',
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: expect.any(String),
        requireInteraction: false,
        silent: false,
      });
    });
  });

  describe('closeNotification', () => {
    it('should close notification by tag', async () => {
      await BrowserNotificationManager.show(
        {
          title: 'Test',
          body: 'Test',
        },
        'test-tag'
      );

      BrowserNotificationManager.closeNotification('test-tag');

      expect(mockNotificationInstance.close).toHaveBeenCalled();
    });

    it('should handle closing non-existent notification', () => {
      expect(() => {
        BrowserNotificationManager.closeNotification('non-existent');
      }).not.toThrow();
    });
  });

  describe('closeAllNotifications', () => {
    it('should close all active notifications', async () => {
      const notification1 = { close: vi.fn() };
      const notification2 = { close: vi.fn() };

      mockNotification.mockReturnValueOnce(notification1).mockReturnValueOnce(notification2);

      await BrowserNotificationManager.show({ title: 'Test1', body: 'Body1' }, 'tag1');
      await BrowserNotificationManager.show({ title: 'Test2', body: 'Body2' }, 'tag2');

      BrowserNotificationManager.closeAllNotifications();

      expect(notification1.close).toHaveBeenCalled();
      expect(notification2.close).toHaveBeenCalled();
    });
  });
});

describe('NotificationTimingManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T14:30:00')); // 2:30 PM local time
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isWithinQuietHours', () => {
    it('should return false when quiet hours disabled', () => {
      const preferences = createMockNotificationPreferences({
        quietHours: { enabled: false, start: '22:00', end: '08:00' },
      });

      const result = NotificationTimingManager.isWithinQuietHours(preferences);

      expect(result).toBe(false);
    });

    it('should detect within overnight quiet hours', () => {
      vi.setSystemTime(new Date('2024-01-15T23:30:00')); // 11:30 PM local time

      const preferences = createMockNotificationPreferences({
        quietHours: { enabled: true, start: '22:00', end: '08:00' },
      });

      const result = NotificationTimingManager.isWithinQuietHours(preferences);

      expect(result).toBe(true);
    });

    it('should detect within early morning quiet hours', () => {
      vi.setSystemTime(new Date('2024-01-15T07:30:00')); // 7:30 AM local time

      const preferences = createMockNotificationPreferences({
        quietHours: { enabled: true, start: '22:00', end: '08:00' },
      });

      const result = NotificationTimingManager.isWithinQuietHours(preferences);

      expect(result).toBe(true);
    });

    it('should detect outside overnight quiet hours', () => {
      vi.setSystemTime(new Date('2024-01-15T14:30:00')); // 2:30 PM local time

      const preferences = createMockNotificationPreferences({
        quietHours: { enabled: true, start: '22:00', end: '08:00' },
      });

      const result = NotificationTimingManager.isWithinQuietHours(preferences);

      expect(result).toBe(false);
    });

    it('should handle same-day quiet hours', () => {
      vi.setSystemTime(new Date('2024-01-15T13:30:00')); // 1:30 PM local time

      const preferences = createMockNotificationPreferences({
        quietHours: { enabled: true, start: '12:00', end: '14:00' },
      });

      const result = NotificationTimingManager.isWithinQuietHours(preferences);

      expect(result).toBe(true);
    });

    it('should detect outside same-day quiet hours', () => {
      vi.setSystemTime(new Date('2024-01-15T15:30:00')); // 3:30 PM local time

      const preferences = createMockNotificationPreferences({
        quietHours: { enabled: true, start: '12:00', end: '14:00' },
      });

      const result = NotificationTimingManager.isWithinQuietHours(preferences);

      expect(result).toBe(false);
    });
  });

  describe('shouldShowNotification', () => {
    const basePreferences = createMockNotificationPreferences({
      enableMilestoneNotifications: true,
      enableDeadlineReminders: true,
      enableStreakNotifications: true,
      enableSummaryNotifications: true,
      enableReminderNotifications: true,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
    });

    it('should allow milestone notifications when enabled', () => {
      const notification = createMockGoalNotification({ type: 'milestone' });

      const result = NotificationTimingManager.shouldShowNotification(
        notification,
        basePreferences
      );

      expect(result).toBe(true);
    });

    it('should block milestone notifications when disabled', () => {
      const notification = createMockGoalNotification({ type: 'milestone' });
      const preferences = { ...basePreferences, enableMilestoneNotifications: false };

      const result = NotificationTimingManager.shouldShowNotification(notification, preferences);

      expect(result).toBe(false);
    });

    it('should allow deadline notifications when enabled', () => {
      const notification = createMockGoalNotification({ type: 'deadline' });

      const result = NotificationTimingManager.shouldShowNotification(
        notification,
        basePreferences
      );

      expect(result).toBe(true);
    });

    it('should block deadline notifications when disabled', () => {
      const notification = createMockGoalNotification({ type: 'deadline' });
      const preferences = { ...basePreferences, enableDeadlineReminders: false };

      const result = NotificationTimingManager.shouldShowNotification(notification, preferences);

      expect(result).toBe(false);
    });

    it('should allow streak notifications when enabled', () => {
      const notification = createMockGoalNotification({ type: 'streak' });

      const result = NotificationTimingManager.shouldShowNotification(
        notification,
        basePreferences
      );

      expect(result).toBe(true);
    });

    it('should allow summary notifications when enabled', () => {
      const notification = createMockGoalNotification({ type: 'summary' });

      const result = NotificationTimingManager.shouldShowNotification(
        notification,
        basePreferences
      );

      expect(result).toBe(true);
    });

    it('should allow reminder notifications when enabled', () => {
      const notification = createMockGoalNotification({ type: 'reminder' });

      const result = NotificationTimingManager.shouldShowNotification(
        notification,
        basePreferences
      );

      expect(result).toBe(true);
    });

    it('should block non-urgent notifications during quiet hours', () => {
      vi.setSystemTime(new Date('2024-01-15T14:30:00')); // 2:30 PM - within quiet hours
      
      const notification = createMockGoalNotification({ type: 'milestone', priority: 'medium' });
      const preferences = {
        ...basePreferences,
        quietHours: { enabled: true, start: '14:00', end: '15:00' },
      };

      const result = NotificationTimingManager.shouldShowNotification(notification, preferences);

      expect(result).toBe(false);
    });

    it('should allow urgent notifications during quiet hours', () => {
      const notification = createMockGoalNotification({ type: 'deadline', priority: 'urgent' });
      const preferences = {
        ...basePreferences,
        quietHours: { enabled: true, start: '14:00', end: '15:00' },
      };

      const result = NotificationTimingManager.shouldShowNotification(notification, preferences);

      expect(result).toBe(true);
    });
  });

  describe('getOptimalNotificationTime', () => {
    it('should schedule morning notification for today if time not passed', () => {
      vi.setSystemTime(new Date('2024-01-15T07:00:00')); // 7:00 AM local time

      const preferences = createMockNotificationPreferences({
        reminderTimes: { morning: '08:00', evening: '18:00' },
      });

      const result = NotificationTimingManager.getOptimalNotificationTime(preferences, 'morning');

      expect(result.getDate()).toBe(15); // Same day
      expect(result.getHours()).toBe(8);
      expect(result.getMinutes()).toBe(0);
    });

    it('should schedule morning notification for tomorrow if time passed', () => {
      const mockDate = new Date('2024-01-15T09:00:00');
      vi.setSystemTime(mockDate); // 9:00 AM local time

      const preferences = createMockNotificationPreferences({
        reminderTimes: { morning: '08:00', evening: '18:00' },
      });

      const result = NotificationTimingManager.getOptimalNotificationTime(preferences, 'morning');

      // Should be scheduled for the next day since 9:00 AM > 8:00 AM
      expect(result.getTime()).toBeGreaterThan(mockDate.getTime());
      expect(result.getHours()).toBe(8);
      expect(result.getMinutes()).toBe(0);
      // Verify it's scheduled for tomorrow
      const expectedDate = new Date(mockDate);
      expectedDate.setDate(expectedDate.getDate() + 1);
      expect(result.getDate()).toBe(expectedDate.getDate());
    });

    it('should schedule evening notification correctly', () => {
      vi.setSystemTime(new Date('2024-01-15T12:00:00')); // 12:00 PM local time

      const preferences = createMockNotificationPreferences({
        reminderTimes: { morning: '08:00', evening: '18:00' },
      });

      const result = NotificationTimingManager.getOptimalNotificationTime(preferences, 'evening');

      expect(result.getDate()).toBe(15); // Same day
      expect(result.getHours()).toBe(18);
      expect(result.getMinutes()).toBe(0);
    });

    it('should handle custom reminder times with minutes', () => {
      vi.setSystemTime(new Date('2024-01-15T07:00:00Z'));

      const preferences = createMockNotificationPreferences({
        reminderTimes: { morning: '08:30', evening: '18:15' },
      });

      const result = NotificationTimingManager.getOptimalNotificationTime(preferences, 'morning');

      expect(result.getHours()).toBe(8);
      expect(result.getMinutes()).toBe(30);
    });
  });
});

describe('NotificationContentGenerator', () => {
  describe('generateMilestoneContent', () => {
    it('should generate 25% milestone content', () => {
      const result = NotificationContentGenerator.generateMilestoneContent(
        'Daily Run',
        25,
        5,
        20,
        'km'
      );

      expect(result.title).toBe('25% Complete! 🌟');
      expect(result.message).toContain('Daily Run');
      expect(result.message).toContain('25%');
      expect(result.message).toContain('5/20 km');
      expect(result.icon).toBe('🌟');
    });

    it('should generate 50% milestone content', () => {
      const result = NotificationContentGenerator.generateMilestoneContent(
        'Weekly Distance',
        50,
        25,
        50,
        'miles'
      );

      expect(result.title).toBe('50% Complete! ⭐');
      expect(result.icon).toBe('⭐');
    });

    it('should generate 75% milestone content', () => {
      const result = NotificationContentGenerator.generateMilestoneContent(
        'Monthly Goal',
        75,
        37.5,
        50,
        'km'
      );

      expect(result.title).toBe('75% Complete! 🔥');
      expect(result.icon).toBe('🔥');
    });

    it('should generate 100% milestone content', () => {
      const result = NotificationContentGenerator.generateMilestoneContent(
        'Goal Complete',
        100,
        50,
        50,
        'runs'
      );

      expect(result.title).toBe('100% Complete! 🏆');
      expect(result.icon).toBe('🏆');
    });

    it('should use default emoji for other percentages', () => {
      const result = NotificationContentGenerator.generateMilestoneContent(
        'Custom Goal',
        60,
        30,
        50,
        'km'
      );

      expect(result.title).toBe('60% Complete! 📈');
      expect(result.icon).toBe('📈');
    });
  });

  describe('generateDeadlineContent', () => {
    it('should generate content for deadline today', () => {
      const result = NotificationContentGenerator.generateDeadlineContent(
        'Urgent Goal',
        0,
        8,
        10,
        'runs'
      );

      expect(result.title).toBe('⏰ Goal Deadline Today!');
      expect(result.icon).toBe('⏰');
      expect(result.message).toContain('80%'); // (8/10) * 100
    });

    it('should generate content for deadline tomorrow', () => {
      const result = NotificationContentGenerator.generateDeadlineContent(
        'Tomorrow Goal',
        1,
        5,
        10,
        'km'
      );

      expect(result.title).toBe('📅 Goal Ends Tomorrow');
      expect(result.icon).toBe('📅');
    });

    it('should generate content for 3 days or less', () => {
      const result = NotificationContentGenerator.generateDeadlineContent(
        'Urgent Goal',
        3,
        7,
        10,
        'miles'
      );

      expect(result.title).toBe('⚠️ 3 Days Left');
      expect(result.icon).toBe('⚠️');
    });

    it('should generate content for more than 3 days', () => {
      const result = NotificationContentGenerator.generateDeadlineContent(
        'Regular Goal',
        7,
        3,
        10,
        'runs'
      );

      expect(result.title).toBe('📋 7 Days Remaining');
      expect(result.icon).toBe('📋');
    });

    it('should calculate progress percentage correctly', () => {
      const result = NotificationContentGenerator.generateDeadlineContent(
        'Test Goal',
        5,
        3,
        4,
        'sessions'
      );

      expect(result.message).toContain('75%'); // (3/4) * 100 = 75%
      expect(result.message).toContain('3/4 sessions');
    });
  });

  describe('generateStreakContent', () => {
    it('should generate daily streak content', () => {
      const result = NotificationContentGenerator.generateStreakContent(
        7,
        'daily',
        'Daily Running'
      );

      expect(result.title).toContain('7 Days Streak!');
      expect(result.message).toContain('7 days');
      expect(result.message).toContain('Daily Running');
      expect(result.icon).toBe('⚡'); // 7 days gets ⚡
    });

    it('should generate weekly streak content', () => {
      const result = NotificationContentGenerator.generateStreakContent(3, 'weekly');

      expect(result.title).toContain('3 Weeks Streak!');
      expect(result.message).toContain('3 weeks');
    });

    it('should handle single day/week/month correctly', () => {
      const dailyResult = NotificationContentGenerator.generateStreakContent(1, 'daily');
      expect(dailyResult.title).toContain('1 Day Streak!');

      const weeklyResult = NotificationContentGenerator.generateStreakContent(1, 'weekly');
      expect(weeklyResult.title).toContain('1 Week Streak!');

      const monthlyResult = NotificationContentGenerator.generateStreakContent(1, 'monthly');
      expect(monthlyResult.title).toContain('1 Month Streak!');
    });

    it('should use appropriate emoji for streak milestones', () => {
      const streak3 = NotificationContentGenerator.generateStreakContent(3, 'daily');
      expect(streak3.icon).toBe('🔥');

      const streak7 = NotificationContentGenerator.generateStreakContent(7, 'daily');
      expect(streak7.icon).toBe('⚡');

      const streak14 = NotificationContentGenerator.generateStreakContent(14, 'daily');
      expect(streak14.icon).toBe('💪');

      const streak21 = NotificationContentGenerator.generateStreakContent(21, 'daily');
      expect(streak21.icon).toBe('🏃‍♂️');

      const streak30 = NotificationContentGenerator.generateStreakContent(30, 'daily');
      expect(streak30.icon).toBe('🏆');
    });

    it('should handle streaks without goal title', () => {
      const result = NotificationContentGenerator.generateStreakContent(5, 'daily');

      expect(result.message).not.toContain('Keep it up with');
      expect(result.message).toContain('Amazing consistency!');
    });
  });

  describe('generateSummaryContent', () => {
    it('should generate weekly summary content', () => {
      const result = NotificationContentGenerator.generateSummaryContent(
        'weekly',
        3,
        5,
        60,
        'Best Goal'
      );

      expect(result.title).toBe('📊 Week Summary');
      expect(result.message).toContain('3/5 goals completed');
      expect(result.message).toContain('60%'); // Completion rate
      expect(result.message).toContain('60%'); // Average progress
      expect(result.message).toContain('Best Goal');
      expect(result.icon).toBe('📊');
    });

    it('should generate monthly summary content', () => {
      const result = NotificationContentGenerator.generateSummaryContent('monthly', 2, 4, 75);

      expect(result.title).toBe('📊 Month Summary');
      expect(result.message).toContain('2/4 goals completed');
      expect(result.message).toContain('50%'); // (2/4) * 100 = 50%
      expect(result.message).toContain('75%'); // Average progress
    });

    it('should handle zero goals correctly', () => {
      const result = NotificationContentGenerator.generateSummaryContent('weekly', 0, 0, 0);

      expect(result.message).toContain('0/0 goals completed (0%)');
      expect(result.message).toContain('Average progress: 0%');
    });

    it('should handle summary without top performing goal', () => {
      const result = NotificationContentGenerator.generateSummaryContent('weekly', 1, 3, 40);

      expect(result.message).not.toContain('Top performer:');
    });
  });

  describe('generateReminderContent', () => {
    it('should generate goal check-in reminder', () => {
      const result = NotificationContentGenerator.generateReminderContent('goal_check_in');

      expect(result.title).toBe('🎯 Goal Check-in Time');
      expect(result.message).toContain('How are your running goals progressing?');
      expect(result.icon).toBe('🎯');
    });

    it('should generate missed run reminder', () => {
      const result = NotificationContentGenerator.generateReminderContent('missed_run');

      expect(result.title).toBe("🏃‍♂️ Haven't seen you lately");
      expect(result.message).toContain("It's been a while since your last run");
      expect(result.icon).toBe('🏃‍♂️');
    });

    it('should generate weekly planning reminder', () => {
      const result = NotificationContentGenerator.generateReminderContent('weekly_planning');

      expect(result.title).toBe('📅 Weekly Goal Planning');
      expect(result.message).toContain('Time to plan your running week!');
      expect(result.icon).toBe('📅');
    });

    it('should handle unknown reminder types', () => {
      const result = NotificationContentGenerator.generateReminderContent('unknown_type');

      expect(result.title).toBe('💭 Reminder');
      expect(result.message).toBe("Don't forget about your running goals!");
      expect(result.icon).toBe('💭');
    });
  });
});

describe('NotificationPreferencesStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('save', () => {
    it('should save preferences to localStorage', () => {
      const preferences = createMockNotificationPreferences({
        enableBrowserNotifications: true,
        enableMilestoneNotifications: false,
      });

      NotificationPreferencesStorage.save(preferences);

      const stored = localStorage.getItem('goalNotificationPreferences');
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored!)).toEqual(preferences);
    });

    it('should handle localStorage errors gracefully', () => {
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage full');
      });

      const preferences = createMockNotificationPreferences();

      expect(() => {
        NotificationPreferencesStorage.save(preferences);
      }).not.toThrow();

      localStorage.setItem = originalSetItem;
    });
  });

  describe('load', () => {
    it('should load preferences from localStorage', () => {
      const preferences = createMockNotificationPreferences({
        enableMilestoneNotifications: false,
        deadlineReminderDays: [1, 3],
      });

      localStorage.setItem('goalNotificationPreferences', JSON.stringify(preferences));

      const loaded = NotificationPreferencesStorage.load();

      expect(loaded).toEqual(preferences);
    });

    it('should return defaults when no stored preferences', () => {
      const loaded = NotificationPreferencesStorage.load();

      expect(loaded).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it('should merge with defaults for partial stored preferences', () => {
      const partialPreferences = {
        enableMilestoneNotifications: false,
        deadlineReminderDays: [1],
      };

      localStorage.setItem('goalNotificationPreferences', JSON.stringify(partialPreferences));

      const loaded = NotificationPreferencesStorage.load();

      expect(loaded.enableMilestoneNotifications).toBe(false);
      expect(loaded.deadlineReminderDays).toEqual([1]);
      expect(loaded.enableBrowserNotifications).toBe(
        DEFAULT_NOTIFICATION_PREFERENCES.enableBrowserNotifications
      );
    });

    it('should handle localStorage errors gracefully', () => {
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage error');
      });

      const loaded = NotificationPreferencesStorage.load();

      expect(loaded).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);

      localStorage.getItem = originalGetItem;
    });

    it('should handle malformed JSON gracefully', () => {
      localStorage.setItem('goalNotificationPreferences', 'invalid json{');

      const loaded = NotificationPreferencesStorage.load();

      expect(loaded).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });
  });

  describe('clear', () => {
    it('should remove preferences from localStorage', () => {
      localStorage.setItem('goalNotificationPreferences', '{"test": true}');

      NotificationPreferencesStorage.clear();

      expect(localStorage.getItem('goalNotificationPreferences')).toBe(null);
    });

    it('should handle localStorage errors gracefully', () => {
      const originalRemoveItem = localStorage.removeItem;
      localStorage.removeItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage error');
      });

      expect(() => {
        NotificationPreferencesStorage.clear();
      }).not.toThrow();

      localStorage.removeItem = originalRemoveItem;
    });
  });
});

describe('DEFAULT_NOTIFICATION_PREFERENCES', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
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
    });
  });
});
