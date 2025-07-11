import React, { useEffect, useState, useCallback } from 'react';

import { Goal, GOAL_TYPE_CONFIGS } from '../types/goals';
import styles from '../styles/components/Notification.module.css';

interface GoalAchievementNotificationProps {
  achievedGoal: Goal | null;
  onClose: () => void;
}

export const GoalAchievementNotification: React.FC<GoalAchievementNotificationProps> = ({
  achievedGoal,
  onClose,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleClose = useCallback(() => {
    setIsAnimating(false);
    setTimeout(() => {
      setIsVisible(false);
      onClose();
    }, 300);
  }, [onClose]);

  useEffect(() => {
    if (achievedGoal) {
      setIsVisible(true);
      setIsAnimating(true);

      // Auto-hide after 8 seconds
      const timer = setTimeout(() => {
        handleClose();
      }, 8000);

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [achievedGoal, handleClose]);

  if (!achievedGoal || !isVisible) return null;

  const config = GOAL_TYPE_CONFIGS[achievedGoal.type];

  return (
    <div className={`${styles.achievementNotification} ${isAnimating ? styles.show : ''}`}>
      <div className={`${styles.achievementModal} ${isAnimating ? styles.animate : ''}`}>
        <button className={styles.achievementClose} onClick={handleClose} aria-label='Close celebration'>
          ✕
        </button>

        <div className={styles.achievementContent}>
          <div className={styles.achievementCelebration}>
            <div className={styles.achievementConfetti}>🎉</div>
            <div className={styles.achievementIcon}>🏆</div>
            <div className={styles.achievementConfetti}>🎊</div>
          </div>

          <div className={styles.achievementHeader}>
            <h2 className={styles.achievementTitle}>Goal Achieved!</h2>
            <p className={styles.achievementDescription}>Congratulations on your accomplishment!</p>
          </div>

          <div className={styles.achievementGoal}>
            <div className={styles.achievementGoalIcon} style={{ color: achievedGoal.color || config.color }}>
              {achievedGoal.icon || config.icon}
            </div>
            <div className={styles.achievementDetails}>
              <h3 className={styles.achievementGoalTitle}>{achievedGoal.title}</h3>
              <p className={styles.achievementGoalType}>{config.label}</p>
              {achievedGoal.description && (
                <p className={styles.achievementGoalDescription}>{achievedGoal.description}</p>
              )}
            </div>
          </div>

          <div className={styles.achievementStats}>
            <div className={styles.achievementStat}>
              <span className={styles.achievementStatLabel}>Target</span>
              <span className={styles.achievementStatValue}>
                {achievedGoal.targetValue} {achievedGoal.targetUnit}
              </span>
            </div>
            <div className={styles.achievementStat}>
              <span className={styles.achievementStatLabel}>Period</span>
              <span className={styles.achievementStatValue}>{achievedGoal.period.toLowerCase()}</span>
            </div>
            {achievedGoal.completedAt && (
              <div className={styles.achievementStat}>
                <span className={styles.achievementStatLabel}>Completed</span>
                <span className={styles.achievementStatValue}>
                  {new Date(achievedGoal.completedAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>

          <div className={styles.achievementMessage}>
            <p>🎯 You&apos;ve successfully reached your goal!</p>
            <p>Keep up the great work and set your next challenge!</p>
          </div>

          <button className={styles.achievementClose} onClick={handleClose}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};
