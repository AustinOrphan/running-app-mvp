import React from 'react';

interface TabNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  swipeHighlight: boolean;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

const tabs = [
  { id: 'runs', label: '📊 Runs' },
  { id: 'goals', label: '🎯 Goals' },
  { id: 'races', label: '🏆 Races' },
  { id: 'stats', label: '📈 Stats' }
];

export const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  onTabChange,
  swipeHighlight,
  onTouchStart,
  onTouchMove,
  onTouchEnd
}) => {
  return (
    <nav className="main-nav">
      {tabs.map(tab => (
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