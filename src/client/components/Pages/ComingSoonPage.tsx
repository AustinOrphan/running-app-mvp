import React from 'react';

interface ComingSoonPageProps {
  title: string;
  description: string;
  icon: string;
}

export const ComingSoonPage: React.FC<ComingSoonPageProps> = ({ title, description, icon }) => {
  return (
    <div className='section tab-panel'>
      <div className='feature-preview'>
        <div className='feature-icon'>{icon}</div>
        <h2>{title}</h2>
        <p>{description}</p>
        <div className='coming-soon-badge'>Coming Soon</div>
      </div>
    </div>
  );
};
