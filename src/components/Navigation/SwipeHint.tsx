import React from 'react';

interface SwipeHintProps {
  show: boolean;
}

export const SwipeHint: React.FC<SwipeHintProps> = ({ show }) => {
  if (!show) return null;

  return (
    <div className="swipe-hint">
      <span className="swipe-text">👈 Swipe to navigate 👉</span>
    </div>
  );
};