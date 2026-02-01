# Analytics Architecture

## Overview

The analytics system provides comprehensive running insights, statistics, and visualizations **using rule-based algorithmic analysis**. This system does **NOT** use external AI services or LLMs for insights generation.

## Design Decision: Rule-Based Insights

**Why rule-based instead of AI?**

- ✅ **No external dependencies**: No third-party API calls required
- ✅ **Zero cost**: No per-request API fees
- ✅ **Privacy-first**: User data never leaves the application
- ✅ **Predictable**: Deterministic, testable, debuggable logic
- ✅ **Fast**: Instant insights without network latency
- ✅ **Transparent**: Users can understand exactly how insights are generated

**Terminology used:**

- "Algorithmic insights" (preferred)
- "Automated insights"
- "Rule-based recommendations"
- ❌ NOT "AI-generated" or "AI-powered"

## System Components

### 1. RunDetail Model

**Purpose**: Extended metadata for individual runs

**Capabilities**:

- Heart rate tracking (avg, max, zone distribution)
- GPS route data (GeoJSON format)
- Elevation profiles (gain, loss, detailed profile)
- Environmental conditions (temperature, humidity, wind, weather)
- Cadence and running form metrics
- Training load and perceived effort

**Storage**: Linked to Run model via one-to-one relation

**Privacy**: All data stored locally in SQLite database

### 2. Analytics Aggregation

**Purpose**: Pre-computed statistics for fast querying

**Models**:

- `RunAnalytics`: Time-period aggregations (daily, weekly, monthly, yearly)
- `RunTendency`: Behavioral patterns and preferences
- `LocationHeatmap`: GPS-based route popularity analysis

**Update Strategy**:

- On-demand recalculation via `/api/analytics/update` endpoint
- Future: Consider scheduled background jobs for active users

### 3. Geospatial Analysis (Turf.js)

**Purpose**: Route clustering and location heatmaps

**Capabilities**:

- **Route Clustering**: Group similar routes using Hausdorff distance approximation
- **Heatmap Generation**: Grid-based GPS point density visualization
- **Popular Routes**: Identify frequently-run paths with overlap detection

**Library**: `@turf/turf` (open-source geospatial analysis)

**Performance**: All calculations run server-side, results cached in database

### 4. Performance Tracking

**Purpose**: Trend analysis and algorithmic insights

**Metrics Tracked**:

- Pace improvements over time
- Volume trends (weekly mileage)
- Consistency scores (adherence to training schedule)
- Heart rate zone distribution
- Training load progression

**Insight Generation Rules**:

```typescript
// Example: Consistency Insight
if (runsThisWeek >= targetRunsPerWeek * 0.9) {
  return {
    type: 'consistency',
    priority: 'high',
    message: 'Great consistency! You hit your weekly run target.',
    actionable: 'Keep up this pace to maintain your progress.',
  };
}

// Example: Recovery Insight
if (avgRestDaysBetween < 1.0) {
  return {
    type: 'recovery',
    priority: 'high',
    message: 'You may be overtraining with insufficient rest days.',
    actionable: 'Consider adding 1-2 rest days per week to prevent injury.',
  };
}

// Example: Performance Insight
if (paceChangePercent < -5.0) {
  // Negative = faster
  return {
    type: 'performance',
    priority: 'medium',
    message: `Your pace improved ${Math.abs(paceChangePercent).toFixed(1)}% this period.`,
    actionable: 'Consider setting a new time goal for your next race.',
  };
}
```

## Data Flow

### Statistics Generation

```
User Request → Analytics Service
                     ↓
            Query RunAnalytics table
                     ↓
            If stale: Aggregate from Run table
                     ↓
            Update RunAnalytics cache
                     ↓
            Return statistics
```

### Insights Generation

```
User Request → Analytics Service
                     ↓
            Load last 90 days of runs
                     ↓
            Apply rule-based algorithms:
              - Consistency checker
              - Volume analyzer
              - Pace trend calculator
              - Recovery evaluator
                     ↓
            Sort by priority
                     ↓
            Return top 5 insights
```

### Heatmap Generation

```
User Request → Geospatial Service
                     ↓
            Load runs with GPS data
                     ↓
            Extract GPS coordinates
                     ↓
            Apply Turf.js grid clustering
                     ↓
            Calculate density per cell
                     ↓
            Cache in LocationHeatmap table
                     ↓
            Return GeoJSON heatmap
```

## API Endpoints

### GET /api/analytics/statistics

**Query Parameters**:

- `period`: `weekly` | `monthly` | `yearly`

**Returns**: Aggregated statistics for the specified period

**Example Response**:

```json
{
  "period": "monthly",
  "startDate": "2026-01-01T00:00:00.000Z",
  "endDate": "2026-01-31T23:59:59.999Z",
  "totalRuns": 18,
  "totalDistance": 127.4,
  "totalDuration": 38400,
  "avgPace": 5.02,
  "fastestPace": 4.15,
  "longestRun": 16.0
}
```

### GET /api/analytics/trends

**Query Parameters**:

- `period`: `weekly` | `monthly`
- `dataPoints`: Number of periods to analyze (2-52)

**Returns**: Trend analysis with pace/volume changes

**Example Response**:

```json
{
  "period": "weekly",
  "dataPoints": 12,
  "paceTrend": "improving",
  "volumeTrend": "stable",
  "paceChangePercent": -3.2,
  "volumeChangePercent": 1.5,
  "consistencyScore": 0.85
}
```

### GET /api/analytics/insights

**Returns**: Rule-based insights sorted by priority

**Example Response**:

```json
{
  "insights": [
    {
      "type": "consistency",
      "priority": "high",
      "message": "Great consistency! You hit your weekly run target.",
      "actionable": "Keep up this pace to maintain your progress."
    },
    {
      "type": "performance",
      "priority": "medium",
      "message": "Your pace improved 3.2% this period.",
      "actionable": "Consider setting a new time goal for your next race."
    }
  ]
}
```

### GET /api/analytics/heatmap

**Query Parameters**:

- `gridSize`: Grid cell size in kilometers (0.1-5.0)

**Returns**: GeoJSON heatmap with density visualization

**Example Response**:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[...]]
      },
      "properties": {
        "density": 12,
        "runsCount": 8
      }
    }
  ]
}
```

## Testing Strategy

### Unit Tests

**Coverage targets**: 80%+ for service logic

**Key test scenarios**:

- Statistics aggregation with edge cases (no runs, single run, many runs)
- Trend calculation with various data patterns
- Insight generation rules (all insight types)
- Route clustering with overlapping/non-overlapping routes
- Heatmap generation with sparse/dense GPS data

### Integration Tests

**Coverage**: All 4 API endpoints

**Key test scenarios**:

- Authentication enforcement
- Query parameter validation
- Error handling (missing data, invalid periods)
- Response format validation

### Performance Tests

**Benchmarks**:

- Statistics query: < 100ms (with 1000+ runs)
- Trend analysis: < 200ms (12-week analysis)
- Insights generation: < 300ms (90-day window)
- Heatmap generation: < 500ms (100+ routes)

## Privacy & Security

**Data Storage**:

- All data stored locally in SQLite database
- No external API calls
- No data transmission to third parties

**Authentication**:

- All endpoints require valid JWT token
- Users can only access their own data
- Row-level security via `userId` filtering

**GDPR Compliance**:

- Right to access: Export via analytics endpoints
- Right to deletion: Cascade delete on user account removal
- Right to portability: JSON export format
- No consent needed for analytics (local processing only)

## Future Enhancements

**Potential additions** (not in current scope):

1. **Machine Learning Models** (optional, local-only):
   - Injury risk prediction using TensorFlow.js
   - Pace prediction for upcoming races
   - Training load optimization
   - **Constraint**: Models must run client-side or server-side locally

2. **Advanced Visualizations**:
   - Pace distribution heat curves
   - Training load fatigue charts
   - Heart rate variability trends

3. **Social Features**:
   - Compare stats with friends (opt-in)
   - Local running club heatmaps
   - **Constraint**: Maintain privacy-first approach

## References

- **Geospatial**: Turf.js Documentation - https://turfjs.org/
- **Training Science**: Jack Daniels' Running Formula (VDOT, training zones)
- **Heart Rate Zones**: 7-zone model based on % of max HR
- **Training Stress Score**: Coggan's TSS formula adapted for running

## Resolution of Issue #403

This document resolves [Issue #403](https://github.com/user/repo/issues/403) by clarifying:

✅ **Insights are rule-based algorithmic analysis**, NOT AI-generated
✅ **No external AI models or APIs** are used
✅ **No API costs, rate limits, or downtime risks**
✅ **No user consent needed** (local processing only)
✅ **No privacy implications** (GDPR-compliant by design)
✅ **Terminology updated** to use "algorithmic insights" throughout codebase

All references to "AI-generated insights" in PR descriptions and code comments should be updated to reflect the rule-based nature of the system.
