import React, { useState } from 'react';

import { PersonalRecord } from '../../types';
import { formatDuration, formatPace, formatDate } from '../../utils/formatters';
import styles from '../../styles/components/Stats.module.css';

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
      <div className={styles.recordsTableCard}>
        <h3>Personal Records</h3>
        <div className={styles.recordsLoading}>
          <div className={styles.tableSkeleton}>
            <div className={`${styles.skeletonRow} ${styles.headerSkeleton}`}>
              {[1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  data-testid='skeleton-line'
                  className={styles.skeletonLine}
                  style={{ width: '80px', height: '16px' }}
                ></div>
              ))}
            </div>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className={styles.skeletonRow}>
                {[1, 2, 3, 4].map(j => (
                  <div
                    key={j}
                    data-testid='skeleton-line'
                    className={styles.skeletonLine}
                    style={{ width: '60px', height: '14px' }}
                  ></div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Ensure records is an array
  const recordsArray = Array.isArray(records) ? records : [];

  if (!recordsArray || recordsArray.length === 0) {
    return (
      <div className={styles.recordsTableCard}>
        <h3>Personal Records</h3>
        <div className={styles.emptyRecords}>
          <div className='empty-icon'>🏆</div>
          <p>No personal records yet</p>
          <span>Run different distances to set your first PRs</span>
        </div>
      </div>
    );
  }

  // Sort records
  const sortedRecords = [...recordsArray].sort((a, b) => {
    let aValue: string | number = a[sortKey];
    let bValue: string | number = b[sortKey];

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

  const HALF_MARATHON_KM = 21.1;
  const MARATHON_KM = 42.2;
  const DISTANCE_TOLERANCE_KM = 0.1;

  const formatDistance = (distance: number) => {
    if (Math.abs(distance - HALF_MARATHON_KM) < DISTANCE_TOLERANCE_KM) return 'Half Marathon';
    if (Math.abs(distance - MARATHON_KM) < DISTANCE_TOLERANCE_KM) return 'Marathon';
    if (distance >= 1) return `${distance}K`;
    return `${(distance * 1000).toFixed(0)}m`;
  };

  return (
    <div className={styles.recordsTableCard}>
      <h3>Personal Records</h3>

      <div className={styles.recordsTableContainer}>
        <table className={styles.recordsTable} aria-label='Personal records table'>
          <thead>
            <tr>
              <th
                className={`${styles.sortable} ${sortKey === 'distance' ? styles.active : ''}`}
                onClick={() => handleSort('distance')}
              >
                Distance {getSortIcon('distance')}
              </th>
              <th
                className={`${styles.sortable} ${sortKey === 'bestTime' ? styles.active : ''}`}
                onClick={() => handleSort('bestTime')}
              >
                Time {getSortIcon('bestTime')}
              </th>
              <th
                className={`${styles.sortable} ${sortKey === 'bestPace' ? styles.active : ''}`}
                onClick={() => handleSort('bestPace')}
              >
                Pace {getSortIcon('bestPace')}
              </th>
              <th
                className={`${styles.sortable} ${sortKey === 'date' ? styles.active : ''}`}
                onClick={() => handleSort('date')}
              >
                Date {getSortIcon('date')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRecords.map(record => (
              <tr key={`${record.distance}-${record.runId}`} className={styles.recordRow}>
                <td className={styles.distanceCell}>
                  <span className={styles.distanceValue}>{formatDistance(record.distance)}</span>
                </td>
                <td className={styles.timeCell}>
                  <span className={styles.timeValue}>{formatDuration(record.bestTime || 0)}</span>
                </td>
                <td className={styles.paceCell}>
                  <span className={styles.paceValue}>
                    {formatPace(record.bestPace || 0, { includeUnit: true })}
                  </span>
                </td>
                <td className={styles.dateCell}>
                  <span className={styles.dateValue}>
                    {formatDate(record.date, 'month-day-year')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.recordsSummary}>
        <div className={styles.recordStat}>
          <span className={styles.statLabel}>Total PRs: </span>
          <span className={styles.statValue}>{recordsArray.length}</span>
        </div>
        <div className={styles.recordStat}>
          <span className={styles.statLabel}>Latest: </span>
          <span className={styles.statValue}>
            {formatDate(
              recordsArray.reduce((latest, record) =>
                new Date(record.date) > new Date(latest.date) ? record : latest
              ).date,
              'month-day-year'
            )}
          </span>
        </div>
      </div>
    </div>
  );
};
