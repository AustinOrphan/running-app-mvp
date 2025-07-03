import React from 'react';
import { NavLink } from 'react-router-dom';

import { TAB_CONFIG } from '../../constants/navigation';

interface TabNavigationProps {
  activeTab: string;
  swipeHighlight: boolean;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

export const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  swipeHighlight,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}) => {
  return (
    <nav className='main-nav'>
      {TAB_CONFIG.map(tab => (
        <NavLink
          key={tab.id}
          to={`/${tab.id}`}
          className={({ isActive }) =>
            `nav-btn ${isActive ? 'active' : ''} ${isActive && swipeHighlight ? 'swipe-highlight' : ''}`
          }
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
