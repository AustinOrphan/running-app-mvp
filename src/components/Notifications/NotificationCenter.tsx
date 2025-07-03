import { formatDistanceToNow } from 'date-fns';
import React, { useState } from 'react';

import { useNotifications } from '../../hooks/useNotifications';
import { GoalNotification } from '../../types/notifications';

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
    const baseClasses = 'notification-item';
    const typeClasses = {
      achievement: 'notification-achievement',
      milestone: 'notification-milestone',
      deadline: 'notification-deadline',
      streak: 'notification-streak',
      summary: 'notification-summary',
      reminder: 'notification-reminder',
    };

    const priorityClasses = {
      urgent: 'notification-urgent',
      high: 'notification-high',
      medium: 'notification-medium',
      low: 'notification-low',
    };

    return `${baseClasses} ${typeClasses[type as keyof typeof typeClasses] || ''} ${priorityClasses[priority as keyof typeof priorityClasses] || ''}`;
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
      className={`${getNotificationStyles(notification.type, notification.priority)} ${!notification.read ? 'unread' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role='button'
      tabIndex={0}
      aria-label={`Mark notification as read: ${notification.title}`}
    >
      <div className='notification-header'>
        <div className='notification-icon' style={{ color: notification.color }}>
          {notification.icon}
        </div>
        <div className='notification-meta'>
          <span className='notification-type'>{notification.type.toUpperCase()}</span>
          <span className='notification-time'>
            {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
          </span>
        </div>
        <button
          className='notification-dismiss'
          onClick={e => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          aria-label='Dismiss notification'
        >
          ×
        </button>
      </div>

      <div className='notification-content'>
        <h4 className='notification-title'>{notification.title}</h4>
        <p className='notification-message'>{notification.message}</p>

        {notification.type === 'milestone' && 'milestonePercentage' in notification && (
          <div className='notification-details'>
            <div className='milestone-progress'>
              <div className='milestone-bar'>
                <div
                  className='milestone-fill'
                  style={{
                    width: `${notification.milestonePercentage}%`,
                    backgroundColor: notification.color,
                  }}
                />
              </div>
              <span className='milestone-text'>
                {notification.currentProgress}/{notification.targetValue} completed
              </span>
            </div>
          </div>
        )}

        {notification.type === 'deadline' && 'daysRemaining' in notification && (
          <div className='notification-details'>
            <div className='deadline-info'>
              <span className='days-remaining'>
                {notification.daysRemaining === 0
                  ? 'Due today!'
                  : notification.daysRemaining === 1
                    ? '1 day left'
                    : `${notification.daysRemaining} days left`}
              </span>
              <div className='deadline-progress'>
                <span className='progress-text'>
                  {Math.round((notification.currentProgress / notification.targetValue) * 100)}%
                  complete
                </span>
              </div>
            </div>
          </div>
        )}

        {notification.type === 'streak' && 'streakCount' in notification && (
          <div className='notification-details'>
            <div className='streak-info'>
              <span className='streak-count'>{notification.streakCount}</span>
              <span className='streak-type'>{notification.streakType} streak</span>
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
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className='notification-center-overlay'
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className='notification-center'
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role='dialog'
        aria-modal='true'
        aria-labelledby='notification-center-title'
        tabIndex={-1}
      >
        <div className='notification-header'>
          <div className='notification-title'>
            <h3 id='notification-center-title'>Notifications</h3>
            {unreadCount > 0 && <span className='unread-badge'>{unreadCount}</span>}
          </div>
          <div className='notification-actions'>
            <button className='btn-icon' onClick={toggleSettings} title='Notification Settings'>
              ⚙️
            </button>
            {notifications.length > 0 && (
              <button className='btn-icon' onClick={handleClearAll} title='Clear All'>
                🗑️
              </button>
            )}
            <button className='btn-icon notification-close' onClick={onClose} title='Close'>
              ×
            </button>
          </div>
        </div>

        {showSettings && (
          <div className='notification-settings'>
            <h4>Notification Preferences</h4>

            {canRequestPermission && (
              <div className='setting-item'>
                <button className='btn-primary' onClick={handleRequestPermission}>
                  Enable Browser Notifications
                </button>
                <p className='setting-description'>Get notified even when the app is not open</p>
              </div>
            )}

            {hasPermission && (
              <div className='setting-item'>
                <label className='setting-toggle'>
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

        <div className='notification-list'>
          {recentNotifications.length === 0 ? (
            <div className='notification-empty'>
              <div className='empty-icon'>🔔</div>
              <h4>No notifications yet</h4>
              <p>
                You&apos;ll see milestone updates, deadline reminders, and achievement celebrations
                here.
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
