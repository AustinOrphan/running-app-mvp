import React from 'react';
import { Card } from '../UI/Card';

interface LoadingSpinnerProps {
  count?: number;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ count = 3 }) => {
  return (
    <div className='runs-grid'>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} variant='run' className='skeleton'>
          <div className='skeleton-line' style={{ width: '60%', height: '20px' }}></div>
          <div
            className='skeleton-line'
            style={{ width: '80%', height: '16px', marginTop: '10px' }}
          ></div>
          <div
            className='skeleton-line'
            style={{ width: '40%', height: '14px', marginTop: '8px' }}
          ></div>
        </Card>
      ))}
    </div>
  );
};

export const EmptyState: React.FC<{ message: string; icon: string }> = ({ message, icon }) => {
  return (
    <div className='empty-state'>
      <div className='empty-icon'>{icon}</div>
      <h3>No runs yet!</h3>
      <p>{message}</p>
    </div>
  );
};
