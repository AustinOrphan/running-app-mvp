import { formatDistanceToNow } from 'date-fns';
import React, { useState } from 'react';

import { useNotifications } from '../../hooks/useNotifications';
import { GoalNotification } from '../../types/notifications';
import styles from '../../styles/components/Notification.module.css';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

const NotificationItem: React.FC<{
  notification: GoalNotification;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
}> = ({ notification, onDismiss, onMarkRead }) => {
  const getNotificationStyles = (type: string, priority: string) => {
    const classes = [styles.notificationItem];

    const typeMap: Record<string, string> = {
      achievement: styles.notificationAchievement,
      milestone: styles.notificationMilestone,
      deadline: styles.notificationDeadline,
      streak: styles.notificationStreak,
      summary: styles.notificationSummary,
      reminder: styles.notificationReminder,
    };

    const priorityMap: Record<string, string> = {
      urgent: styles.notificationUrgent,
      high: styles.notificationHigh,
      medium: styles.notificationMedium,
      low: styles.notificationLow,
    };

    if (typeMap[type]) classes.push(typeMap[type]);
    if (priorityMap[priority]) classes.push(priorityMap[priority]);

    return classes.join(' ');
  };

  const handleClick = () => {
    if (!notification.read) {
      onMarkRead(notification.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      className={`${getNotificationStyles(notification.type, notification.priority)} ${!notification.read ? styles.unread : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role='button'
      tabIndex={0}
      aria-label={`Mark notification as read: ${notification.title}`}
    >
      <div className={styles.notificationHeader}>
        <div className={styles.notificationIcon} style={{ color: notification.color }}>
          {notification.icon}
        </div>
        <div className={styles.notificationMeta}>
          <span className={styles.notificationType}>{notification.type.toUpperCase()}</span>
          <span className={styles.notificationTime}>
            {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
          </span>
        </div>
        <button
          className={styles.notificationDismiss}
          onClick={e => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          aria-label='Dismiss notification'
        >
          ×
        </button>
      </div>

      <div className={styles.notificationContent}>
        <h4 className={styles.notificationTitle}>{notification.title}</h4>
        <p className={styles.notificationMessage}>{notification.message}</p>

        {notification.type === 'milestone' && 'milestonePercentage' in notification && (
          <div className={styles.notificationDetails}>
            <div className={styles.milestoneProgress}>
              <div className={styles.milestoneBar}>
                <div
                  className={styles.milestoneFill}
                  style={{
                    width: `${notification.milestonePercentage}%`,
                    backgroundColor: notification.color,
                  }}
                />
              </div>
              <span className={styles.milestoneText}>
                {notification.currentProgress}/{notification.targetValue} completed
              </span>
            </div>
          </div>
        )}

        {notification.type === 'deadline' && 'daysRemaining' in notification && (
          <div className={styles.notificationDetails}>
            <div className={styles.deadlineInfo}>
              <span className={styles.daysRemaining}>
                {notification.daysRemaining === 0
                  ? 'Due today!'
                  : notification.daysRemaining === 1
                    ? '1 day left'
                    : `${notification.daysRemaining} days left`}
              </span>
              <div className={styles.deadlineProgress}>
                <span className={styles.progressText}>
                  {Math.round((notification.currentProgress / notification.targetValue) * 100)}%
                  complete
                </span>
              </div>
            </div>
          </div>
        )}

        {notification.type === 'streak' && 'streakCount' in notification && (
          <div className={styles.notificationDetails}>
            <div className={styles.streakInfo}>
              <span className={styles.streakCount}>{notification.streakCount}</span>
              <span className={styles.streakType}>{notification.streakType} streak</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ isOpen, onClose }) => {
  const {
    notifications,
    preferences,
    hasPermission,
    canRequestPermission,
    requestPermission,
    updatePreferences,
    dismissNotification,
    markAsRead,
    clearAllNotifications,
    getUnreadCount,
  } = useNotifications();

  const [showSettings, setShowSettings] = useState(false);

  const unreadCount = getUnreadCount();
  const recentNotifications = notifications.slice(0, 20); // Show last 20 notifications

  const handleRequestPermission = async () => {
    await requestPermission();
  };

  const handleClearAll = () => {
    clearAllNotifications();
  };

  const toggleSettings = () => {
    setShowSettings(!showSettings);
  };

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <div
      className={styles.notificationCenterOverlay}
      role='button'
      tabIndex={0}
      aria-label='Close modal'
      onClick={onClose}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className={`${styles.notificationCenter} ${isOpen ? styles.open : ''}`}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role='dialog'
        aria-modal='true'
        aria-labelledby='notification-center-title'
        tabIndex={-1}
      >
        <div className={styles.notificationCenterHeader}>
          <div className={styles.notificationCenterTitle}>
            <h3 id='notification-center-title'>Notifications</h3>
            {unreadCount > 0 && <span className={styles.unreadBadge}>{unreadCount}</span>}
          </div>
          <div className={styles.notificationActions}>
            <button
              className={styles.btnIcon}
              onClick={toggleSettings}
              title='Notification Settings'
            >
              ⚙️
            </button>
            {notifications.length > 0 && (
              <button className={styles.btnIcon} onClick={handleClearAll} title='Clear All'>
                🗑️
              </button>
            )}
            <button
              className={`${styles.btnIcon} ${styles.notificationCenterClose}`}
              onClick={onClose}
              title='Close'
            >
              ×
            </button>
          </div>
        </div>

        {showSettings && (
          <div className={styles.notificationSettings}>
            <h4>Notification Preferences</h4>

            {canRequestPermission && (
              <div className={styles.settingItem}>
                <button className={styles.btnPrimary} onClick={handleRequestPermission}>
                  Enable Browser Notifications
                </button>
                <p className={styles.settingDescription}>Get notified even when the app is not open</p>
              </div>
            )}

            {hasPermission && (
              <div className={styles.settingItem}>
                <label className={styles.settingToggle}>
                  <input
                    type='checkbox'
                    checked={preferences.enableBrowserNotifications}
                    onChange={e =>
                      updatePreferences({ enableBrowserNotifications: e.target.checked })
                    }
                  />
                  <span>Browser Notifications</span>
                </label>
              </div>
            )}

            <div className='setting-item'>
              <label className='setting-toggle'>
                <input
                  type='checkbox'
                  checked={preferences.enableMilestoneNotifications}
                  onChange={e =>
                    updatePreferences({ enableMilestoneNotifications: e.target.checked })
                  }
                />
                <span>Milestone Notifications</span>
              </label>
            </div>

            <div className='setting-item'>
              <label className='setting-toggle'>
                <input
                  type='checkbox'
                  checked={preferences.enableDeadlineReminders}
                  onChange={e => updatePreferences({ enableDeadlineReminders: e.target.checked })}
                />
                <span>Deadline Reminders</span>
              </label>
            </div>

            <div className='setting-item'>
              <label className='setting-toggle'>
                <input
                  type='checkbox'
                  checked={preferences.enableStreakNotifications}
                  onChange={e => updatePreferences({ enableStreakNotifications: e.target.checked })}
                />
                <span>Streak Notifications</span>
              </label>
            </div>

            <div className='setting-item'>
              <label className='setting-toggle'>
                <input
                  type='checkbox'
                  checked={preferences.enableSummaryNotifications}
                  onChange={e =>
                    updatePreferences({ enableSummaryNotifications: e.target.checked })
                  }
                />
                <span>Weekly/Monthly Summaries</span>
              </label>
            </div>

            <div className='setting-item'>
              <label className='setting-toggle'>
                <input
                  type='checkbox'
                  checked={preferences.quietHours.enabled}
                  onChange={e =>
                    updatePreferences({
                      quietHours: { ...preferences.quietHours, enabled: e.target.checked },
                    })
                  }
                />
                <span>Quiet Hours (22:00 - 08:00)</span>
              </label>
            </div>
          </div>
        )}

        <div className={styles.notificationList}>
          {recentNotifications.length === 0 ? (
            <div className={styles.notificationEmpty}>
              <div className={styles.emptyIcon}>🔔</div>
              <h4>No notifications yet</h4>
              <p>
                {`You'll see milestone updates, deadline reminders, and achievement celebrations here.`}
              </p>
            </div>
          ) : (
            recentNotifications.map(notification => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onDismiss={dismissNotification}
                onMarkRead={markAsRead}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
