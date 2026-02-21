import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useAnalyticsHeatmap, HeatmapFeature } from '../../hooks/useAnalyticsHeatmap';

export const HeatmapMap: React.FC = () => {
  const { getToken } = useAuth();
  const [gridSize, setGridSize] = useState(0.5);
  const { heatmap, loading, error } = useAnalyticsHeatmap(getToken(), gridSize);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw heatmap on canvas
  useEffect(() => {
    if (!heatmap || !canvasRef.current || heatmap.features.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get canvas dimensions
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear canvas
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (!heatmap.bbox) return;

    const [minLng, minLat, maxLng, maxLat] = heatmap.bbox;
    const lngRange = maxLng - minLng;
    const latRange = maxLat - minLat;

    // Find max density for color scaling
    const maxDensity = Math.max(...heatmap.features.map(f => f.properties.density));

    // Draw each grid cell
    heatmap.features.forEach((feature: HeatmapFeature) => {
      const coords = feature.geometry.coordinates[0];
      const density = feature.properties.density;

      // Normalize density to 0-1
      const normalizedDensity = density / maxDensity;

      // Color gradient from blue (low) to red (high)
      const hue = (1 - normalizedDensity) * 240; // 240 = blue, 0 = red
      const saturation = 70 + normalizedDensity * 30; // 70-100%
      const lightness = 40 + normalizedDensity * 20; // 40-60%
      ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

      // Draw polygon
      ctx.beginPath();
      coords.forEach(([lng, lat], index) => {
        const x = ((lng - minLng) / lngRange) * rect.width;
        const y = rect.height - ((lat - minLat) / latRange) * rect.height;

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });
  }, [heatmap]);

  const handleGridSizeChange = (newSize: number) => {
    setGridSize(newSize);
  };

  if (loading) {
    return (
      <div className="heatmap-container">
        <div className="heatmap-header">
          <h3>GPS Heatmap</h3>
          <div className="skeleton-line" style={{ width: '200px', height: '36px' }}></div>
        </div>
        <div className="heatmap-loading">
          <div className="loading-spinner">🗺️</div>
          <p>Loading heatmap...</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="heatmap-container">
        <div className="heatmap-header">
          <h3>GPS Heatmap</h3>
        </div>
        <div className="heatmap-error">
          <div className="error-icon">⚠️</div>
          <div className="error-message">{error}</div>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (!heatmap || heatmap.features.length === 0) {
    return (
      <div className="heatmap-container">
        <div className="heatmap-header">
          <h3>GPS Heatmap</h3>
        </div>
        <div className="heatmap-empty">
          <div className="empty-icon">🗺️</div>
          <div className="empty-message">No GPS data available</div>
          <div className="empty-hint">
            Record runs with GPS tracking to see your activity heatmap
          </div>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  const maxDensity = Math.max(...heatmap.features.map(f => f.properties.density));
  const totalCells = heatmap.features.length;

  return (
    <div className="heatmap-container">
      <div className="heatmap-header">
        <div className="header-content">
          <h3>GPS Heatmap</h3>
          <p className="heatmap-stats">
            {totalCells} grid cells · Max density: {maxDensity} points
          </p>
        </div>
        <div className="heatmap-controls">
          <label htmlFor="grid-size" className="control-label">
            Grid Size:
          </label>
          <select
            id="grid-size"
            value={gridSize}
            onChange={e => handleGridSizeChange(Number(e.target.value))}
            className="grid-size-selector"
          >
            <option value={0.1}>0.1 km (Fine)</option>
            <option value={0.5}>0.5 km (Medium)</option>
            <option value={1.0}>1.0 km (Coarse)</option>
            <option value={2.0}>2.0 km (Very Coarse)</option>
          </select>
        </div>
      </div>

      <div className="heatmap-canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="heatmap-canvas"
          role="img"
          aria-label={`GPS activity heatmap showing ${totalCells} grid cells`}
        ></canvas>
      </div>

      <div className="heatmap-legend">
        <div className="legend-label">Activity Density</div>
        <div className="legend-gradient"></div>
        <div className="legend-labels">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>

      <div className="heatmap-info">
        <div className="info-item">
          <span className="info-icon">📍</span>
          <span className="info-text">
            Showing {totalCells} areas where you've run
          </span>
        </div>
        <div className="info-item">
          <span className="info-icon">🔥</span>
          <span className="info-text">
            Brighter colors indicate higher activity
          </span>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
};

const styles = `
  .heatmap-container {
    background: var(--color-background-subtle);
    border-radius: var(--border-radius);
    padding: 1.5rem;
  }

  .heatmap-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .header-content {
    flex: 1;
  }

  .heatmap-header h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .heatmap-stats {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }

  .heatmap-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .control-label {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
    font-weight: 500;
  }

  .grid-size-selector {
    padding: 0.5rem 1rem;
    border: 2px solid var(--color-border);
    border-radius: var(--border-radius);
    background: var(--color-background);
    color: var(--color-text-primary);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .grid-size-selector:hover {
    border-color: var(--color-primary);
  }

  .grid-size-selector:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .heatmap-canvas-wrapper {
    width: 100%;
    height: 400px;
    background: #1f2937;
    border-radius: var(--border-radius);
    overflow: hidden;
    margin-bottom: 1rem;
    position: relative;
  }

  .heatmap-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .heatmap-legend {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .legend-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .legend-gradient {
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(
      to right,
      hsl(240, 70%, 40%),
      hsl(180, 80%, 50%),
      hsl(120, 85%, 55%),
      hsl(60, 90%, 60%),
      hsl(0, 100%, 60%)
    );
  }

  .legend-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .heatmap-info {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
  }

  .info-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .info-icon {
    font-size: 1.25rem;
  }

  .info-text {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
  }

  .heatmap-loading,
  .heatmap-empty,
  .heatmap-error {
    text-align: center;
    padding: 3rem 1rem;
    background: var(--color-background);
    border-radius: var(--border-radius);
  }

  .loading-spinner {
    font-size: 3rem;
    margin-bottom: 1rem;
    animation: bounce 1s ease-in-out infinite;
  }

  @keyframes bounce {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-10px);
    }
  }

  .heatmap-loading p {
    margin: 0;
    color: var(--color-text-secondary);
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .empty-message {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: 0.5rem;
  }

  .empty-hint {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
  }

  .error-icon {
    font-size: 2.5rem;
    margin-bottom: 1rem;
  }

  .error-message {
    color: var(--color-danger, #ef4444);
    font-weight: 500;
  }

  .skeleton-line {
    background: linear-gradient(
      90deg,
      var(--color-background-subtle) 25%,
      var(--color-border) 50%,
      var(--color-background-subtle) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 4px;
  }

  @keyframes shimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }

  @media (max-width: 640px) {
    .heatmap-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .heatmap-controls {
      width: 100%;
    }

    .grid-size-selector {
      flex: 1;
    }

    .heatmap-canvas-wrapper {
      height: 300px;
    }
  }
`;
