import React from 'react';

import { Run } from '../../types';
import { calculatePace, formatDuration, formatDate } from '../../utils/formatters';
import {
  Card,
  CardHeader,
  CardContent,
  CardActions,
  IconButton,
} from '../UI/Card';

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
    <Card variant="run">
      <CardHeader variant="run">
        <div className="run-date">{formatDate(run.date)}</div>
        <CardActions variant="run">
          <IconButton
            variant="edit"
            onClick={() => onEdit(run)}
            title="Edit run"
          >
            ✏️
          </IconButton>
          <IconButton
            variant="delete"
            onClick={handleDelete}
            title="Delete run"
          >
            🗑️
          </IconButton>
        </CardActions>
      </CardHeader>

      <CardContent>
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

        {run.notes && (
          <div className="run-notes">{run.notes}</div>
        )}
      </CardContent>
    </Card>
  );
};