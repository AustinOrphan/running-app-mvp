import React from 'react';

interface HeaderProps {
  healthStatus: string;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ healthStatus, onLogout }) => {
  return (
    <header>
      <h1>🏃‍♂️ Running Tracker</h1>
      <div className='header-actions'>
        <div className='status'>{healthStatus}</div>
        <button onClick={onLogout} className='logout-btn'>
          Logout
        </button>
      </div>
    </header>
  );
};
