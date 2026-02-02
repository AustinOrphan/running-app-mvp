# API Endpoints Documentation

## Analytics Endpoints

All analytics endpoints require authentication via JWT token in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

### GET /api/analytics/statistics

Get aggregated running statistics for a time period.

**Query Parameters:**

- `period` (required): `weekly` | `monthly` | `yearly`

**Example Request:**

```bash
GET /api/analytics/statistics?period=weekly
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200 OK):**

```json
{
  "period": "weekly",
  "startDate": "2026-01-27T00:00:00.000Z",
  "endDate": "2026-02-02T23:59:59.999Z",
  "totalRuns": 5,
  "totalDistance": 42.5,
  "totalDuration": 12600,
  "avgPace": 4.96,
  "fastestPace": 4.2,
  "longestRun": 15.0,
  "totalElevation": 450,
  "avgHeartRate": 152,
  "maxHeartRate": 178
}
```

**Field Descriptions:**

- `totalDuration`: Total seconds running
- `avgPace`: Average pace in minutes per kilometer
- `fastestPace`: Best pace in minutes per kilometer
- `totalDistance`: Total kilometers run
- `totalElevation`: Total elevation gain in meters (if available)
- `avgHeartRate`: Average heart rate in BPM (if available)
- `maxHeartRate`: Maximum heart rate in BPM (if available)

**Error Responses:**

- `400 Bad Request`: Invalid period parameter
- `401 Unauthorized`: Missing or invalid token

---

### GET /api/analytics/trends

Get trend analysis over multiple time periods.

**Query Parameters:**

- `period` (optional): `weekly` | `monthly` (default: `weekly`)
- `dataPoints` (optional): Number of periods to analyze, 2-52 (default: `12`)

**Example Request:**

```bash
GET /api/analytics/trends?period=weekly&dataPoints=12
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200 OK):**

```json
{
  "period": "weekly",
  "dataPoints": 12,
  "paceTrend": "improving",
  "volumeTrend": "increasing",
  "paceChangePercent": -8.5,
  "volumeChangePercent": 12.3,
  "consistencyScore": 0.83
}
```

**Field Descriptions:**

- `paceTrend`: `improving` (pace getting faster) | `stable` | `declining` (pace getting slower)
- `volumeTrend`: `increasing` | `stable` | `decreasing`
- `paceChangePercent`: Percent change in pace (negative = improvement)
- `volumeChangePercent`: Percent change in weekly mileage
- `consistencyScore`: 0-1 score for training consistency (1 = perfect)

**Trend Thresholds:**

- Pace: ±5% change = trend
- Volume: ±5% change = trend
- Otherwise classified as "stable"

**Error Responses:**

- `400 Bad Request`: Invalid period or dataPoints out of range
- `401 Unauthorized`: Missing or invalid token

---

### GET /api/analytics/insights

Get rule-based algorithmic insights about running performance.

**Query Parameters:** None

**Example Request:**

```bash
GET /api/analytics/insights
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200 OK):**

```json
{
  "insights": [
    {
      "type": "consistency",
      "priority": "high",
      "message": "Great consistency! You've completed 4 runs this week.",
      "actionable": "Keep up this pace to maintain your progress."
    },
    {
      "type": "performance",
      "priority": "medium",
      "message": "Your pace improved 6.2% over the last 3 months.",
      "actionable": "Consider setting a new time goal for your next race."
    },
    {
      "type": "recovery",
      "priority": "high",
      "message": "You may be overtraining with insufficient rest days.",
      "actionable": "Consider adding 1-2 rest days per week to prevent injury."
    }
  ]
}
```

**Field Descriptions:**

- `type`: `consistency` | `volume` | `recovery` | `performance` | `goal`
- `priority`: `high` | `medium` | `low`
- `message`: Human-readable insight description
- `actionable`: Recommended action (optional)

**Insight Types:**

1. **Consistency**
   - Target: 3+ runs per week
   - Triggers on achieving or missing weekly targets

2. **Recovery**
   - Analyzes rest days between runs
   - Warns if average rest < 1 day (overtraining risk)
   - Suggests extra rest if average rest ≥ 2 days

3. **Performance**
   - Compares pace over 3-month periods
   - Identifies improvements (≥5% faster) or declines (≥10% slower)

4. **Volume**
   - Detects sudden mileage increases (>50% = injury risk)
   - Detects significant decreases (>30%)
   - References the "10% rule" for safe volume increases

**Analysis Window:** Last 90 days

**Sorting:** Insights sorted by priority (high → medium → low)

**Error Responses:**

- `401 Unauthorized`: Missing or invalid token

---

### GET /api/analytics/heatmap

Get GPS heatmap of running locations with grid-based density visualization.

**Query Parameters:**

- `gridSize` (optional): Grid cell size in kilometers, 0.1-5.0 (default: `0.5`)

**Example Request:**

```bash
GET /api/analytics/heatmap?gridSize=0.5
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200 OK):**

```json
{
  "type": "FeatureCollection",
  "bbox": [-97.75, 30.25, -97.73, 30.28],
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [-97.7435, 30.265],
            [-97.7385, 30.265],
            [-97.7385, 30.27],
            [-97.7435, 30.27],
            [-97.7435, 30.265]
          ]
        ]
      },
      "properties": {
        "density": 15
      }
    }
  ]
}
```

**Field Descriptions:**

- `type`: Always `FeatureCollection` (GeoJSON standard)
- `bbox`: `[minLng, minLat, maxLng, maxLat]` bounding box for all points
- `features`: Array of grid cells with density data
- `density`: Number of GPS points within this grid cell

**Grid Calculation:**

- Latitude: ~111 km per degree (constant)
- Longitude: ~111 km × cos(latitude) per degree (varies)
- Grid aligned to lat/lng coordinates, not true north

**Use Cases:**

- Visualize frequently-run areas
- Identify favorite routes
- Display running patterns on maps

**Error Responses:**

- `400 Bad Request`: gridSize out of range (0.1-5.0)
- `401 Unauthorized`: Missing or invalid token

---

## Common Error Responses

All endpoints may return these errors:

### 401 Unauthorized

```json
{
  "error": "Authentication required"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal server error"
}
```

---

## Rate Limiting

All analytics endpoints use the `readRateLimit` middleware:

- Default: 100 requests per 15 minutes per IP
- Exceeding limit returns `429 Too Many Requests`

---

## Security

- All endpoints require valid JWT authentication
- Input sanitization applied to all query parameters
- Security headers (HSTS, CSP, etc.) enforced
- SQL injection prevention via Prisma ORM

---

## Examples

### Complete Workflow: Weekly Stats → Insights

```bash
# 1. Get weekly statistics
curl -X GET "https://api.example.com/api/analytics/statistics?period=weekly" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 2. Get performance insights
curl -X GET "https://api.example.com/api/analytics/insights" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. Get 12-week trend analysis
curl -X GET "https://api.example.com/api/analytics/trends?period=weekly&dataPoints=12" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Visualizing Running Patterns

```bash
# Get heatmap data for popular routes (0.5km grid)
curl -X GET "https://api.example.com/api/analytics/heatmap?gridSize=0.5" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Fine-grained heatmap (100m grid)
curl -X GET "https://api.example.com/api/analytics/heatmap?gridSize=0.1" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Implementation Notes

### Rule-Based Insights

The insights endpoint uses **algorithmic analysis**, not AI or machine learning:

- No external API dependencies
- Zero API costs
- Privacy-friendly (all data stays on server)
- Predictable, testable logic
- Fast response times

See `docs/ANALYTICS_ARCHITECTURE.md` for full technical details.

### Heart Rate Data

When `RunDetail.avgHeartRate` is available, analytics calculations use heart rate zones for:

- More accurate effort estimation
- Better TSS (Training Stress Score) calculations
- Improved fitness profile analysis

Falls back to pace-based estimation when HR data unavailable.

---

## Related Documentation

- `docs/ANALYTICS_ARCHITECTURE.md` - System architecture and design decisions
- `docs/TRAINING_PLANS_IMPLEMENTATION.md` - Training plan integration with analytics
- `server/routes/analytics.ts` - Route implementation
- `server/services/analyticsService.ts` - Core analytics logic
- `server/services/geospatialService.ts` - Heatmap and route clustering
