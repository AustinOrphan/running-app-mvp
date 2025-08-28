import React from 'react';
import { NavLink } from 'react-router';

import { TAB_CONFIG } from '../../constants/navigation';
import styles from '../../styles/components/Navigation.module.css';

interface TabNavigationProps {
  swipeHighlight: boolean;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

export const TabNavigation: React.FC<TabNavigationProps> = ({
  swipeHighlight,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}) => {
  return (
    <nav className={styles.mainNav}>
      {TAB_CONFIG.map(tab => (
        <NavLink
          key={tab.id}
          to={`/${tab.id}`}
          className={({ isActive }) => {
            const classNames = [styles.navBtn];
            if (isActive) {
              classNames.push(styles.active);
              if (swipeHighlight) {
                classNames.push(styles.swipeHighlight);
              }
            }
            return classNames.join(' ');
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
};
