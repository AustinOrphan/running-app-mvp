import React from 'react';

import styles from '../../styles/components/Navigation.module.css';
import { ThemeToggleCompact } from '../ThemeToggle';

interface HeaderProps {
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onLogout }) => {
  return (
    <header className={styles.header}>
      <h1>🏃‍♂️ Running Tracker</h1>
      <div className={styles.headerActions}>
        <ThemeToggleCompact />
        <button onClick={onLogout} className={styles.logoutBtn}>
          Logout
        </button>
      </div>
    </header>
  );
};
