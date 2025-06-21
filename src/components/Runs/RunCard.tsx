import React from 'react';
import { Run } from '../../types';
import { calculatePace, formatDuration, formatDate } from '../../utils/formatters';

interface RunCardProps {
  run: Run;
  onEdit: (run: Run) => void;
  onDelete: (runId: string) => void;
}

export const RunCard: React.FC<RunCardProps> = ({ run, onEdit, onDelete }) => {
  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this run?')) {
      onDelete(run.id);
    }
  };

  return (
    <div className="run-card">
      <div className="run-header">
        <div className="run-date">
          {formatDate(run.date)}
        </div>
        <div className="run-actions">
          <button 
            onClick={() => onEdit(run)}
            className="icon-btn edit-btn"
            title="Edit run"
          >
            ✏️
          </button>
          <button 
            onClick={handleDelete}
            className="icon-btn delete-btn"
            title="Delete run"
          >
            🗑️
          </button>
        </div>
      </div>
      <div className="run-stats">
        <div className="stat">
          <span className="stat-value">{run.distance}km</span>
          <span className="stat-label">Distance</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatDuration(run.duration)}</span>
          <span className="stat-label">Duration</span>
        </div>
        <div className="stat">
          <span className="stat-value">{calculatePace(run.distance, run.duration)}</span>
          <span className="stat-label">Pace/km</span>
        </div>
      </div>
      {run.tag && (
        <div className="run-tag">
          <span className="tag">{run.tag}</span>
        </div>
      )}
      {run.notes && <div className="run-notes">{run.notes}</div>}
    </div>
  );
};