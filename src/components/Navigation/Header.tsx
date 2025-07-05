import React from 'react';

interface HeaderProps {
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onLogout }) => {
  return (
    <header>
      <h1>🏃‍♂️ Running Tracker</h1>
      <div className='header-actions'>
        <button onClick={onLogout} className='logout-btn'>
          Logout
        </button>
      </div>
    </header>
  );
};
