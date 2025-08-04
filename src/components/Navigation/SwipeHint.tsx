import React from 'react';

import styles from '../../styles/components/Navigation.module.css';

interface SwipeHintProps {
  show: boolean;
}

export const SwipeHint: React.FC<SwipeHintProps> = ({ show }) => {
  if (!show) return null;

  return (
    <div className={styles.swipeHint}>
      <span className={styles.swipeText}>👈 Swipe to navigate 👉</span>
    </div>
  );
};
