import React, { useState } from 'react';
import { PersonalRecord } from '../../types';
import { formatDuration } from '../../utils/formatters';

interface PersonalRecordsTableProps {
  records: PersonalRecord[];
  loading: boolean;
}

type SortKey = 'distance' | 'bestTime' | 'bestPace' | 'date';
type SortDirection = 'asc' | 'desc';

export const PersonalRecordsTable: React.FC<PersonalRecordsTableProps> = ({ records, loading }) => {
  const [sortKey, setSortKey] = useState<SortKey>('distance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (key: SortKey) => {
    if (sortKey !== key) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  if (loading) {
    return (
      <div className="records-table-card">
        <h3>Personal Records</h3>
        <div className="records-loading">
          <div className="table-skeleton">
            <div className="skeleton-row header-skeleton">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton-line" style={{width: '80px', height: '16px'}}></div>
              ))}
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton-row">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="skeleton-line" style={{width: '60px', height: '14px'}}></div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div className="records-table-card">
        <h3>Personal Records</h3>
        <div className="empty-records">
          <div className="empty-icon">🏆</div>
          <p>No personal records yet</p>
          <span>Run different distances to set your first PRs</span>
        </div>
      </div>
    );
  }

  // Sort records
  const sortedRecords = [...records].sort((a, b) => {
    let aValue: any = a[sortKey];
    let bValue: any = b[sortKey];

    if (sortKey === 'date') {
      aValue = new Date(aValue).getTime();
      bValue = new Date(bValue).getTime();
    }

    if (sortDirection === 'asc') {
      return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
    } else {
      return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
    }
  });

  const formatDistance = (distance: number) => {
    const HALF_MARATHON_KM = 21.1;
    const MARATHON_KM = 42.2;
    const DISTANCE_TOLERANCE_KM = 0.1;

    if (Math.abs(distance - HALF_MARATHON_KM) < DISTANCE_TOLERANCE_KM) return 'Half Marathon';
    if (Math.abs(distance - MARATHON_KM) < DISTANCE_TOLERANCE_KM) return 'Marathon';
    if (distance >= 1) return `${distance}K`;
    return `${(distance * 1000).toFixed(0)}m`;
  };

  const formatPace = (pace: number) => {
    if (pace === 0) return '-';
    const minutes = Math.floor(pace / 60);
    const seconds = Math.round(pace % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
  };

  const formatRecordDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="records-table-card">
      <h3>Personal Records</h3>
      
      <div className="records-table-container">
        <table className="records-table">
          <thead>
            <tr>
              <th 
                className={`sortable ${sortKey === 'distance' ? 'active' : ''}`}
                onClick={() => handleSort('distance')}
              >
                Distance {getSortIcon('distance')}
              </th>
              <th 
                className={`sortable ${sortKey === 'bestTime' ? 'active' : ''}`}
                onClick={() => handleSort('bestTime')}
              >
                Time {getSortIcon('bestTime')}
              </th>
              <th 
                className={`sortable ${sortKey === 'bestPace' ? 'active' : ''}`}
                onClick={() => handleSort('bestPace')}
              >
                Pace {getSortIcon('bestPace')}
              </th>
              <th 
                className={`sortable ${sortKey === 'date' ? 'active' : ''}`}
                onClick={() => handleSort('date')}
              >
                Date {getSortIcon('date')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRecords.map((record) => (
              <tr key={`${record.distance}-${record.runId}`} className="record-row">
                <td className="distance-cell">
                  <span className="distance-value">{formatDistance(record.distance)}</span>
                </td>
                <td className="time-cell">
                  <span className="time-value">{formatDuration(record.bestTime)}</span>
                </td>
                <td className="pace-cell">
                  <span className="pace-value">{formatPace(record.bestPace)}</span>
                </td>
                <td className="date-cell">
                  <span className="date-value">{formatRecordDate(record.date)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="records-summary">
        <div className="record-stat">
          <span className="stat-label">Total PRs: </span>
          <span className="stat-value">{records.length}</span>
        </div>
        <div className="record-stat">
          <span className="stat-label">Latest: </span>
          <span className="stat-value">
            {formatRecordDate(
              records.reduce((latest, record) => 
                new Date(record.date) > new Date(latest.date) ? record : latest
              ).date
            )}
          </span>
        </div>
      </div>
    </div>
  );
};