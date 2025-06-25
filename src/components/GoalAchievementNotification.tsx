import React, { useEffect, useState } from 'react';

import { Goal, GOAL_TYPE_CONFIGS } from '../types/goals';

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
  }, [achievedGoal]);

  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(() => {
      setIsVisible(false);
      onClose();
    }, 300);
  };

  if (!achievedGoal || !isVisible) return null;

  const config = GOAL_TYPE_CONFIGS[achievedGoal.type];

  return (
    <div className={`achievement-overlay ${isAnimating ? 'show' : ''}`}>
      <div className={`achievement-notification ${isAnimating ? 'animate' : ''}`}>
        <button className='achievement-close' onClick={handleClose} aria-label='Close celebration'>
          ✕
        </button>

        <div className='achievement-content'>
          <div className='achievement-celebration'>
            <div className='achievement-confetti'>🎉</div>
            <div className='achievement-trophy'>🏆</div>
            <div className='achievement-confetti'>🎊</div>
          </div>

          <div className='achievement-header'>
            <h2>Goal Achieved!</h2>
            <p className='achievement-subtitle'>Congratulations on your accomplishment!</p>
          </div>

          <div className='achievement-goal'>
            <div className='achievement-icon' style={{ color: achievedGoal.color || config.color }}>
              {achievedGoal.icon || config.icon}
            </div>
            <div className='achievement-details'>
              <h3>{achievedGoal.title}</h3>
              <p className='achievement-type'>{config.label}</p>
              {achievedGoal.description && (
                <p className='achievement-description'>{achievedGoal.description}</p>
              )}
            </div>
          </div>

          <div className='achievement-stats'>
            <div className='achievement-stat'>
              <span className='achievement-stat-label'>Target</span>
              <span className='achievement-stat-value'>
                {achievedGoal.targetValue} {achievedGoal.targetUnit}
              </span>
            </div>
            <div className='achievement-stat'>
              <span className='achievement-stat-label'>Period</span>
              <span className='achievement-stat-value'>{achievedGoal.period.toLowerCase()}</span>
            </div>
            {achievedGoal.completedAt && (
              <div className='achievement-stat'>
                <span className='achievement-stat-label'>Completed</span>
                <span className='achievement-stat-value'>
                  {new Date(achievedGoal.completedAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>

          <div className='achievement-message'>
            <p>🎯 You've successfully reached your goal!</p>
            <p>Keep up the great work and set your next challenge!</p>
          </div>

          <button className='achievement-action-btn' onClick={handleClose}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};
