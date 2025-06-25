import React from 'react';

import { TAB_CONFIG } from '../../constants/navigation';

interface TabNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  swipeHighlight: boolean;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

export const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  onTabChange,
  swipeHighlight,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}) => {
  return (
    <nav className='main-nav'>
      {TAB_CONFIG.map(tab => (
        <button
          key={tab.id}
          className={`nav-btn ${activeTab === tab.id ? 'active' : ''} ${activeTab === tab.id && swipeHighlight ? 'swipe-highlight' : ''}`}
          onClick={() => onTabChange(tab.id)}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
};
