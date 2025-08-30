# Running App MVP - API Documentation

## Overview

The Running App MVP API is a RESTful web service that provides comprehensive functionality for tracking running activities, managing goals, and analyzing performance data. This documentation covers all available endpoints, request/response formats, and usage examples.

## Base URL

- **Development**: `http://localhost:3001/api`
- **Production**: `https://api.runningapp.com/api`

## Authentication

The API uses JSON Web Tokens (JWT) for authentication. All protected endpoints require an Authorization header:

```
Authorization: Bearer <access_token>
```

### Token Lifecycle

- **Access Token**: Valid for 15 minutes, used for API requests
- **Refresh Token**: Valid for 7 days, used to obtain new access tokens
- **Token Blacklisting**: Logout immediately invalidates tokens

## Rate Limiting

Different rate limits apply to different endpoint categories:

- **Authentication endpoints**: 5 requests per 15 minutes per IP
- **Read operations**: 100 requests per 15 minutes per user
- **Write operations**: 20 requests per 15 minutes per user
- **General API**: 100 requests per 15 minutes per IP

Rate limit headers are included in responses:

- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Time when rate limit resets

## Error Handling

The API uses standard HTTP status codes and returns errors in a consistent JSON format:

```json
{
  "error": "Error Type",
  "message": "Human-readable error message",
  "details": {
    "field": "Additional context"
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### Common Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (authentication required)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (resource already exists)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

## API Endpoints

### Authentication

#### Test Authentication Routes

Test endpoint to verify authentication service is working.

```http
GET /api/auth/test
```

**Response:**

```json
{
  "message": "Auth routes are working",
  "timestamp": "2024-01-15T12:00:00Z"
}
```

#### User Registration

Create a new user account.

```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (201):**

```json
{
  "message": "User created successfully",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "clm123abc456",
    "email": "user@example.com"
  }
}
```

**Validation Rules:**

- Email: Must be valid email format
- Password: Minimum 8 characters, must contain letters and numbers

#### User Login

Authenticate with email and password.

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200):**

```json
{
  "message": "Login successful",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "clm123abc456",
    "email": "user@example.com"
  }
}
```

#### Verify Token

Verify current JWT token and get user information.

```http
GET /api/auth/verify
Authorization: Bearer <access_token>
```

**Response (200):**

```json
{
  "user": {
    "id": "clm123abc456",
    "email": "user@example.com"
  }
}
```

#### Refresh Token

Get a new access token using refresh token.

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**

```json
{
  "message": "Token refreshed successfully",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Logout

Logout user and blacklist tokens.

```http
POST /api/auth/logout
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**

```json
{
  "message": "Logged out successfully"
}
```

### Goals Management

#### Get All Goals

Retrieve all active goals for the authenticated user.

```http
GET /api/goals
Authorization: Bearer <access_token>
```

**Response (200):**

```json
[
  {
    "id": "clm123abc456",
    "userId": "clm123abc456",
    "type": "distance",
    "period": "weekly",
    "targetValue": 50.0,
    "currentValue": 25.5,
    "isCompleted": false,
    "isActive": true,
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-12-31T23:59:59Z",
    "createdAt": "2024-01-01T12:00:00Z",
    "updatedAt": "2024-01-15T12:00:00Z"
  }
]
```

#### Create Goal

Create a new running goal.

```http
POST /api/goals
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "type": "distance",
  "period": "weekly",
  "targetValue": 50.0,
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-12-31T23:59:59Z"
}
```

**Goal Types:**

- `distance` - Distance-based goal (kilometers)
- `time` - Time-based goal (minutes)
- `frequency` - Frequency goal (number of runs)
- `pace` - Pace goal (minutes per kilometer)

**Periods:**

- `daily` - Daily goal
- `weekly` - Weekly goal
- `monthly` - Monthly goal
- `yearly` - Yearly goal

**Response (201):**

```json
{
  "id": "clm123abc456",
  "userId": "clm123abc456",
  "type": "distance",
  "period": "weekly",
  "targetValue": 50.0,
  "currentValue": 0,
  "isCompleted": false,
  "isActive": true,
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-12-31T23:59:59Z",
  "createdAt": "2024-01-15T12:00:00Z",
  "updatedAt": "2024-01-15T12:00:00Z"
}
```

#### Get Specific Goal

Retrieve details of a specific goal.

```http
GET /api/goals/{id}
Authorization: Bearer <access_token>
```

#### Update Goal

Update an existing goal.

```http
PUT /api/goals/{id}
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "targetValue": 60.0,
  "currentValue": 30.5
}
```

#### Delete Goal

Soft delete a goal (marks as inactive).

```http
DELETE /api/goals/{id}
Authorization: Bearer <access_token>
```

**Response (200):**

```json
{
  "message": "Goal deleted successfully"
}
```

### Runs Management

#### Get All Runs

Retrieve all runs for the authenticated user.

```http
GET /api/runs
Authorization: Bearer <access_token>
```

**Response (200):**

```json
[
  {
    "id": "clm123abc456",
    "userId": "clm123abc456",
    "date": "2024-01-15T08:00:00Z",
    "distance": 5.2,
    "duration": 1800,
    "pace": 5.77,
    "runType": "easy",
    "notes": "Great morning run",
    "createdAt": "2024-01-15T12:00:00Z",
    "updatedAt": "2024-01-15T12:00:00Z"
  }
]
```

#### Get Simplified Run List

Get a simplified list with basic run information.

```http
GET /api/runs/simple-list
Authorization: Bearer <access_token>
```

**Response (200):**

```json
[
  {
    "id": "clm123abc456",
    "date": "2024-01-15T08:00:00Z",
    "distance": 5.2,
    "duration": 1800,
    "runType": "easy"
  }
]
```

#### Create Run

Create a new running activity.

```http
POST /api/runs
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "date": "2024-01-15T08:00:00Z",
  "distance": 5.2,
  "duration": 1800,
  "runType": "easy",
  "notes": "Great morning run"
}
```

**Run Types (examples):**

- `easy` - Easy/recovery run
- `tempo` - Tempo run
- `intervals` - Interval training
- `long` - Long run
- `race` - Race

**Response (201):**

```json
{
  "id": "clm123abc456",
  "userId": "clm123abc456",
  "date": "2024-01-15T08:00:00Z",
  "distance": 5.2,
  "duration": 1800,
  "pace": 5.77,
  "runType": "easy",
  "notes": "Great morning run",
  "createdAt": "2024-01-15T12:00:00Z",
  "updatedAt": "2024-01-15T12:00:00Z"
}
```

#### Get Specific Run

Retrieve details of a specific run.

```http
GET /api/runs/{id}
Authorization: Bearer <access_token>
```

#### Update Run

Update an existing run.

```http
PUT /api/runs/{id}
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "distance": 5.5,
  "duration": 1900,
  "notes": "Updated notes"
}
```

#### Delete Run

Delete a run permanently.

```http
DELETE /api/runs/{id}
Authorization: Bearer <access_token>
```

### Races Management

#### Get All Races

Retrieve all races for the authenticated user.

```http
GET /api/races
Authorization: Bearer <access_token>
```

**Response (200):**

```json
[
  {
    "id": "clm123abc456",
    "userId": "clm123abc456",
    "name": "Boston Marathon",
    "distance": 42.195,
    "raceDate": "2024-04-15T09:00:00Z",
    "targetTime": 10800,
    "actualTime": 10650,
    "location": "Boston, MA",
    "notes": "Personal best!",
    "createdAt": "2024-01-15T12:00:00Z",
    "updatedAt": "2024-04-15T15:00:00Z"
  }
]
```

#### Create Race

Create a new race event.

```http
POST /api/races
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Boston Marathon",
  "distance": 42.195,
  "raceDate": "2024-04-15T09:00:00Z",
  "targetTime": 10800,
  "location": "Boston, MA",
  "notes": "Training for PR"
}
```

**Response (201):**

```json
{
  "id": "clm123abc456",
  "userId": "clm123abc456",
  "name": "Boston Marathon",
  "distance": 42.195,
  "raceDate": "2024-04-15T09:00:00Z",
  "targetTime": 10800,
  "actualTime": null,
  "location": "Boston, MA",
  "notes": "Training for PR",
  "createdAt": "2024-01-15T12:00:00Z",
  "updatedAt": "2024-01-15T12:00:00Z"
}
```

#### Get Specific Race

Retrieve details of a specific race.

```http
GET /api/races/{id}
Authorization: Bearer <access_token>
```

#### Update Race

Update an existing race.

```http
PUT /api/races/{id}
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "actualTime": 10650,
  "notes": "Personal best! Great race."
}
```

#### Delete Race

Delete a race permanently.

```http
DELETE /api/races/{id}
Authorization: Bearer <access_token>
```

### Statistics

#### Get Weekly Insights Summary

Retrieve weekly running statistics and insights.

```http
GET /api/stats/insights-summary
Authorization: Bearer <access_token>
```

**Response (200):**

```json
{
  "totalDistance": 25.5,
  "totalDuration": 7200,
  "totalRuns": 5,
  "avgPace": 4.71,
  "weekStart": "2024-01-08T00:00:00Z",
  "weekEnd": "2024-01-15T00:00:00Z",
  "hasData": true
}
```

#### Get Run Type Breakdown

Retrieve statistics broken down by run type.

```http
GET /api/stats/type-breakdown
Authorization: Bearer <access_token>
```

**Response (200):**

```json
{
  "breakdown": [
    {
      "runType": "easy",
      "count": 10,
      "totalDistance": 50.5,
      "averagePace": 5.25
    },
    {
      "runType": "tempo",
      "count": 3,
      "totalDistance": 15.0,
      "averagePace": 4.15
    }
  ]
}
```

### Audit (Admin Only)

#### Query Audit Events

Query audit events with filters. Requires admin access.

```http
GET /api/audit/events?action=create&entityType=run&limit=50
Authorization: Bearer <admin_access_token>
```

**Query Parameters:**

- `action` - Filter by action type (create, update, delete, etc.)
- `entityType` - Filter by entity type (user, run, goal, race)
- `startDate` - Filter events after this date (ISO 8601)
- `endDate` - Filter events before this date (ISO 8601)
- `limit` - Maximum number of events (1-1000, default: 100)
- `offset` - Number of events to skip (default: 0)

**Response (200):**

```json
{
  "events": [
    {
      "id": "clm123abc456",
      "timestamp": "2024-01-15T12:00:00Z",
      "action": "create",
      "entityType": "run",
      "entityId": "clm123abc456",
      "outcome": "success",
      "details": {
        "distance": 5.2,
        "duration": 1800
      }
    }
  ],
  "pagination": {
    "total": 1000,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

## Data Types and Validation

### Goal Types

- **distance**: Target distance in kilometers (decimal)
- **time**: Target time in minutes (integer)
- **frequency**: Target number of runs (integer)
- **pace**: Target pace in minutes per kilometer (decimal)

### Goal Periods

- **daily**: Resets every day at midnight
- **weekly**: Resets every Monday at midnight
- **monthly**: Resets on the 1st of each month
- **yearly**: Resets on January 1st

### Run Data

- **distance**: Distance in kilometers (minimum 0.1)
- **duration**: Duration in seconds (minimum 1)
- **pace**: Automatically calculated as duration/distance
- **date**: ISO 8601 datetime string
- **runType**: String identifier for run category

### Race Data

- **distance**: Race distance in kilometers
- **targetTime**: Target completion time in seconds
- **actualTime**: Actual completion time in seconds (optional)
- **raceDate**: ISO 8601 datetime string

## Security Features

### Input Validation

- All inputs are sanitized to prevent XSS attacks
- Request validation using Zod schemas
- SQL injection prevention via Prisma ORM

### Rate Limiting

- Different limits for different endpoint types
- IP-based limiting for public endpoints
- User-based limiting for authenticated endpoints

### Audit Logging

- All API actions are logged for security monitoring
- Includes user ID, action type, and request details
- Failed authentication attempts are tracked

### CORS Configuration

- Configured for specific origins in production
- Credentials support for cookie-based authentication

### Security Headers

- Helmet.js for standard security headers
- Content Security Policy (CSP)
- HTTP Strict Transport Security (HSTS)

## Examples

### Complete User Flow Example

1. **Register a new user:**

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"runner@example.com","password":"runfast123"}'
```

2. **Create a running goal:**

```bash
curl -X POST http://localhost:3001/api/goals \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "distance",
    "period": "weekly",
    "targetValue": 25.0,
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-12-31T23:59:59Z"
  }'
```

3. **Log a new run:**

```bash
curl -X POST http://localhost:3001/api/runs \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2024-01-15T08:00:00Z",
    "distance": 5.0,
    "duration": 1800,
    "runType": "easy",
    "notes": "Beautiful morning run"
  }'
```

4. **Get weekly statistics:**

```bash
curl -X GET http://localhost:3001/api/stats/insights-summary \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Error Response Examples

**Validation Error (400):**

```json
{
  "error": "Validation failed",
  "message": "Invalid email format",
  "details": {
    "field": "email",
    "code": "INVALID_EMAIL"
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

**Authentication Error (401):**

```json
{
  "error": "Unauthorized",
  "message": "Invalid or expired token",
  "timestamp": "2024-01-15T12:00:00Z"
}
```

**Not Found Error (404):**

```json
{
  "error": "Not Found",
  "message": "Run not found",
  "timestamp": "2024-01-15T12:00:00Z"
}
```

**Rate Limit Error (429):**

```json
{
  "error": "Rate Limit Exceeded",
  "message": "Too many requests, please try again later",
  "timestamp": "2024-01-15T12:00:00Z"
}
```

## OpenAPI Specification

A complete OpenAPI 3.0 specification is available at `/docs/api/openapi.yaml`. This can be used with tools like Swagger UI or Postman for interactive API exploration.

## Testing

### Using curl

All examples in this documentation can be tested using curl. Replace `YOUR_ACCESS_TOKEN` with actual tokens obtained from authentication endpoints.

### Using Postman

Import the OpenAPI specification into Postman for a complete interactive API collection.

### Integration Tests

The API includes comprehensive integration tests covering all endpoints. Run tests with:

```bash
npm run test:integration
```

## Support

For API support or questions:

- **Email**: support@runningapp.com
- **Documentation**: See `/docs` directory
- **Issues**: GitHub repository issues
- **Status**: Check API status at status.runningapp.com
