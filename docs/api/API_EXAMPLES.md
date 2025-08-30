# Running App API - Request/Response Examples

This document provides comprehensive examples of API requests and responses for all endpoints in the Running App MVP.

## Table of Contents

- [Authentication Examples](#authentication-examples)
- [Goals Management Examples](#goals-management-examples)
- [Runs Management Examples](#runs-management-examples)
- [Races Management Examples](#races-management-examples)
- [Statistics Examples](#statistics-examples)
- [Audit Examples](#audit-examples)
- [Error Examples](#error-examples)

## Authentication Examples

### Register New User

**Request:**

```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "runner@example.com",
  "password": "RunnerPassword123!"
}
```

**Response (201):**

```json
{
  "message": "User created successfully",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNsbTEyM2FiYzQ1NiIsImVtYWlsIjoicnVubmVyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzA1MzE1MjAwLCJleHAiOjE3MDUzMTYxMDAsInR5cGUiOiJhY2Nlc3MifQ.example_signature",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNsbTEyM2FiYzQ1NiIsImVtYWlsIjoicnVubmVyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzA1MzE1MjAwLCJleHAiOjE3MDU5MjAwMDAsInR5cGUiOiJyZWZyZXNoIn0.example_signature",
  "user": {
    "id": "clm123abc456",
    "email": "runner@example.com"
  }
}
```

**Curl Example:**

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "runner@example.com",
    "password": "RunnerPassword123!"
  }'
```

### User Login

**Request:**

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "runner@example.com",
  "password": "RunnerPassword123!"
}
```

**Response (200):**

```json
{
  "message": "Login successful",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNsbTEyM2FiYzQ1NiIsImVtYWlsIjoicnVubmVyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzA1MzE1MjAwLCJleHAiOjE3MDUzMTYxMDAsInR5cGUiOiJhY2Nlc3MifQ.example_signature",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNsbTEyM2FiYzQ1NiIsImVtYWlsIjoicnVubmVyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzA1MzE1MjAwLCJleHAiOjE3MDU5MjAwMDAsInR5cGUiOiJyZWZyZXNoIn0.example_signature",
  "user": {
    "id": "clm123abc456",
    "email": "runner@example.com"
  }
}
```

### Token Verification

**Request:**

```http
GET /api/auth/verify
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNsbTEyM2FiYzQ1NiIsImVtYWlsIjoicnVubmVyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzA1MzE1MjAwLCJleHAiOjE3MDUzMTYxMDAsInR5cGUiOiJhY2Nlc3MifQ.example_signature
```

**Response (200):**

```json
{
  "user": {
    "id": "clm123abc456",
    "email": "runner@example.com"
  }
}
```

### Token Refresh

**Request:**

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNsbTEyM2FiYzQ1NiIsImVtYWlsIjoicnVubmVyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzA1MzE1MjAwLCJleHAiOjE3MDU5MjAwMDAsInR5cGUiOiJyZWZyZXNoIn0.example_signature"
}
```

**Response (200):**

```json
{
  "message": "Token refreshed successfully",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNsbTEyM2FiYzQ1NiIsImVtYWlsIjoicnVubmVyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzA1MzE1MjAwLCJleHAiOjE3MDUzMTYxMDAsInR5cGUiOiJhY2Nlc3MifQ.new_signature"
}
```

## Goals Management Examples

### Create Weekly Distance Goal

**Request:**

```http
POST /api/goals
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "type": "distance",
  "period": "weekly",
  "targetValue": 25.0,
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-12-31T23:59:59Z"
}
```

**Response (201):**

```json
{
  "id": "clm789def012",
  "userId": "clm123abc456",
  "type": "distance",
  "period": "weekly",
  "targetValue": 25.0,
  "currentValue": 0,
  "isCompleted": false,
  "isActive": true,
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-12-31T23:59:59Z",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

### Create Monthly Frequency Goal

**Request:**

```http
POST /api/goals
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "type": "frequency",
  "period": "monthly",
  "targetValue": 12,
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-12-31T23:59:59Z"
}
```

**Response (201):**

```json
{
  "id": "clm789def013",
  "userId": "clm123abc456",
  "type": "frequency",
  "period": "monthly",
  "targetValue": 12,
  "currentValue": 0,
  "isCompleted": false,
  "isActive": true,
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-12-31T23:59:59Z",
  "createdAt": "2024-01-15T10:35:00Z",
  "updatedAt": "2024-01-15T10:35:00Z"
}
```

### Get All Goals

**Request:**

```http
GET /api/goals
Authorization: Bearer <access_token>
```

**Response (200):**

```json
[
  {
    "id": "clm789def012",
    "userId": "clm123abc456",
    "type": "distance",
    "period": "weekly",
    "targetValue": 25.0,
    "currentValue": 15.5,
    "isCompleted": false,
    "isActive": true,
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-12-31T23:59:59Z",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-18T08:45:00Z"
  },
  {
    "id": "clm789def013",
    "userId": "clm123abc456",
    "type": "frequency",
    "period": "monthly",
    "targetValue": 12,
    "currentValue": 4,
    "isCompleted": false,
    "isActive": true,
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-12-31T23:59:59Z",
    "createdAt": "2024-01-15T10:35:00Z",
    "updatedAt": "2024-01-18T08:45:00Z"
  }
]
```

### Update Goal Progress

**Request:**

```http
PUT /api/goals/clm789def012
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "currentValue": 20.5
}
```

**Response (200):**

```json
{
  "id": "clm789def012",
  "userId": "clm123abc456",
  "type": "distance",
  "period": "weekly",
  "targetValue": 25.0,
  "currentValue": 20.5,
  "isCompleted": false,
  "isActive": true,
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-12-31T23:59:59Z",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-19T14:20:00Z"
}
```

## Runs Management Examples

### Log a Morning Run

**Request:**

```http
POST /api/runs
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "date": "2024-01-19T07:30:00Z",
  "distance": 8.5,
  "duration": 2580,
  "runType": "easy",
  "notes": "Beautiful sunrise run along the river trail"
}
```

**Response (201):**

```json
{
  "id": "clm456ghi789",
  "userId": "clm123abc456",
  "date": "2024-01-19T07:30:00Z",
  "distance": 8.5,
  "duration": 2580,
  "pace": 5.06,
  "runType": "easy",
  "notes": "Beautiful sunrise run along the river trail",
  "createdAt": "2024-01-19T08:15:00Z",
  "updatedAt": "2024-01-19T08:15:00Z"
}
```

### Log a Tempo Run

**Request:**

```http
POST /api/runs
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "date": "2024-01-17T18:00:00Z",
  "distance": 6.0,
  "duration": 1440,
  "runType": "tempo",
  "notes": "4x1 mile tempo intervals with 2 min recovery"
}
```

**Response (201):**

```json
{
  "id": "clm456ghi790",
  "userId": "clm123abc456",
  "date": "2024-01-17T18:00:00Z",
  "distance": 6.0,
  "duration": 1440,
  "pace": 4.0,
  "runType": "tempo",
  "notes": "4x1 mile tempo intervals with 2 min recovery",
  "createdAt": "2024-01-17T19:30:00Z",
  "updatedAt": "2024-01-17T19:30:00Z"
}
```

### Get All Runs

**Request:**

```http
GET /api/runs
Authorization: Bearer <access_token>
```

**Response (200):**

```json
[
  {
    "id": "clm456ghi789",
    "userId": "clm123abc456",
    "date": "2024-01-19T07:30:00Z",
    "distance": 8.5,
    "duration": 2580,
    "pace": 5.06,
    "runType": "easy",
    "notes": "Beautiful sunrise run along the river trail",
    "createdAt": "2024-01-19T08:15:00Z",
    "updatedAt": "2024-01-19T08:15:00Z"
  },
  {
    "id": "clm456ghi790",
    "userId": "clm123abc456",
    "date": "2024-01-17T18:00:00Z",
    "distance": 6.0,
    "duration": 1440,
    "pace": 4.0,
    "runType": "tempo",
    "notes": "4x1 mile tempo intervals with 2 min recovery",
    "createdAt": "2024-01-17T19:30:00Z",
    "updatedAt": "2024-01-17T19:30:00Z"
  }
]
```

### Get Simplified Run List

**Request:**

```http
GET /api/runs/simple-list
Authorization: Bearer <access_token>
```

**Response (200):**

```json
[
  {
    "id": "clm456ghi789",
    "date": "2024-01-19T07:30:00Z",
    "distance": 8.5,
    "duration": 2580,
    "runType": "easy"
  },
  {
    "id": "clm456ghi790",
    "date": "2024-01-17T18:00:00Z",
    "distance": 6.0,
    "duration": 1440,
    "runType": "tempo"
  }
]
```

### Update Run Details

**Request:**

```http
PUT /api/runs/clm456ghi789
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "distance": 8.7,
  "duration": 2640,
  "notes": "Beautiful sunrise run along the river trail - extended route"
}
```

**Response (200):**

```json
{
  "id": "clm456ghi789",
  "userId": "clm123abc456",
  "date": "2024-01-19T07:30:00Z",
  "distance": 8.7,
  "duration": 2640,
  "pace": 5.06,
  "runType": "easy",
  "notes": "Beautiful sunrise run along the river trail - extended route",
  "createdAt": "2024-01-19T08:15:00Z",
  "updatedAt": "2024-01-19T14:22:00Z"
}
```

## Races Management Examples

### Register for Marathon

**Request:**

```http
POST /api/races
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Boston Marathon 2024",
  "distance": 42.195,
  "raceDate": "2024-04-15T09:00:00Z",
  "targetTime": 10800,
  "location": "Boston, MA",
  "notes": "Aiming for sub-3 hour finish. Weather looks good!"
}
```

**Response (201):**

```json
{
  "id": "clm321jkl654",
  "userId": "clm123abc456",
  "name": "Boston Marathon 2024",
  "distance": 42.195,
  "raceDate": "2024-04-15T09:00:00Z",
  "targetTime": 10800,
  "actualTime": null,
  "location": "Boston, MA",
  "notes": "Aiming for sub-3 hour finish. Weather looks good!",
  "createdAt": "2024-01-19T15:30:00Z",
  "updatedAt": "2024-01-19T15:30:00Z"
}
```

### Register for 10K Race

**Request:**

```http
POST /api/races
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Spring 10K Classic",
  "distance": 10.0,
  "raceDate": "2024-03-10T08:30:00Z",
  "targetTime": 2400,
  "location": "Central Park, NY",
  "notes": "Good tune-up race before marathon training"
}
```

**Response (201):**

```json
{
  "id": "clm321jkl655",
  "userId": "clm123abc456",
  "name": "Spring 10K Classic",
  "distance": 10.0,
  "raceDate": "2024-03-10T08:30:00Z",
  "targetTime": 2400,
  "actualTime": null,
  "location": "Central Park, NY",
  "notes": "Good tune-up race before marathon training",
  "createdAt": "2024-01-19T16:00:00Z",
  "updatedAt": "2024-01-19T16:00:00Z"
}
```

### Update Race Results

**Request:**

```http
PUT /api/races/clm321jkl655
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "actualTime": 2340,
  "notes": "Great race! New PR by 30 seconds. Perfect weather conditions."
}
```

**Response (200):**

```json
{
  "id": "clm321jkl655",
  "userId": "clm123abc456",
  "name": "Spring 10K Classic",
  "distance": 10.0,
  "raceDate": "2024-03-10T08:30:00Z",
  "targetTime": 2400,
  "actualTime": 2340,
  "location": "Central Park, NY",
  "notes": "Great race! New PR by 30 seconds. Perfect weather conditions.",
  "createdAt": "2024-01-19T16:00:00Z",
  "updatedAt": "2024-03-10T10:15:00Z"
}
```

### Get All Races

**Request:**

```http
GET /api/races
Authorization: Bearer <access_token>
```

**Response (200):**

```json
[
  {
    "id": "clm321jkl655",
    "userId": "clm123abc456",
    "name": "Spring 10K Classic",
    "distance": 10.0,
    "raceDate": "2024-03-10T08:30:00Z",
    "targetTime": 2400,
    "actualTime": 2340,
    "location": "Central Park, NY",
    "notes": "Great race! New PR by 30 seconds. Perfect weather conditions.",
    "createdAt": "2024-01-19T16:00:00Z",
    "updatedAt": "2024-03-10T10:15:00Z"
  },
  {
    "id": "clm321jkl654",
    "userId": "clm123abc456",
    "name": "Boston Marathon 2024",
    "distance": 42.195,
    "raceDate": "2024-04-15T09:00:00Z",
    "targetTime": 10800,
    "actualTime": null,
    "location": "Boston, MA",
    "notes": "Aiming for sub-3 hour finish. Weather looks good!",
    "createdAt": "2024-01-19T15:30:00Z",
    "updatedAt": "2024-01-19T15:30:00Z"
  }
]
```

## Statistics Examples

### Weekly Insights Summary

**Request:**

```http
GET /api/stats/insights-summary
Authorization: Bearer <access_token>
```

**Response (200):**

```json
{
  "totalDistance": 32.5,
  "totalDuration": 9180,
  "totalRuns": 6,
  "avgPace": 4.71,
  "weekStart": "2024-01-15T00:00:00Z",
  "weekEnd": "2024-01-22T00:00:00Z",
  "hasData": true
}
```

### Run Type Breakdown

**Request:**

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
      "count": 15,
      "totalDistance": 92.5,
      "averagePace": 5.15
    },
    {
      "runType": "tempo",
      "count": 4,
      "totalDistance": 24.0,
      "averagePace": 4.25
    },
    {
      "runType": "intervals",
      "count": 3,
      "totalDistance": 15.0,
      "averagePace": 3.85
    },
    {
      "runType": "long",
      "count": 2,
      "totalDistance": 40.0,
      "averagePace": 5.45
    }
  ]
}
```

## Audit Examples

### Query Recent Audit Events

**Request:**

```http
GET /api/audit/events?limit=10&action=create
Authorization: Bearer <admin_access_token>
```

**Response (200):**

```json
{
  "events": [
    {
      "id": "clm987zyx321",
      "timestamp": "2024-01-19T08:15:00Z",
      "action": "create",
      "entityType": "run",
      "entityId": "clm456ghi789",
      "outcome": "success",
      "details": {
        "distance": 8.5,
        "duration": 2580,
        "runType": "easy"
      }
    },
    {
      "id": "clm987zyx322",
      "timestamp": "2024-01-19T16:00:00Z",
      "action": "create",
      "entityType": "race",
      "entityId": "clm321jkl655",
      "outcome": "success",
      "details": {
        "name": "Spring 10K Classic",
        "distance": 10.0
      }
    }
  ],
  "pagination": {
    "total": 1247,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

### Query Failed Authentication Events

**Request:**

```http
GET /api/audit/events?action=login&outcome=failure&startDate=2024-01-18T00:00:00Z
Authorization: Bearer <admin_access_token>
```

**Response (200):**

```json
{
  "events": [
    {
      "id": "clm987zyx325",
      "timestamp": "2024-01-18T14:22:00Z",
      "action": "login",
      "entityType": "auth",
      "entityId": "unknown",
      "outcome": "failure",
      "details": {
        "email": "attacker@example.com",
        "reason": "invalid_credentials",
        "ip": "192.168.1.100"
      }
    },
    {
      "id": "clm987zyx326",
      "timestamp": "2024-01-18T14:23:00Z",
      "action": "login",
      "entityType": "auth",
      "entityId": "unknown",
      "outcome": "failure",
      "details": {
        "email": "attacker@example.com",
        "reason": "invalid_credentials",
        "ip": "192.168.1.100"
      }
    }
  ],
  "pagination": {
    "total": 15,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  }
}
```

## Error Examples

### Validation Error Example

**Request:**

```http
POST /api/runs
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "date": "invalid-date",
  "distance": -5.0,
  "duration": 0
}
```

**Response (400):**

```json
{
  "error": "Validation failed",
  "message": "Invalid input data provided",
  "details": {
    "date": "Invalid date format",
    "distance": "Distance must be greater than 0",
    "duration": "Duration must be greater than 0"
  },
  "timestamp": "2024-01-19T10:30:00Z"
}
```

### Authentication Error Example

**Request:**

```http
GET /api/goals
Authorization: Bearer invalid_token_here
```

**Response (401):**

```json
{
  "error": "Unauthorized",
  "message": "Invalid or expired token",
  "timestamp": "2024-01-19T10:30:00Z"
}
```

### Not Found Error Example

**Request:**

```http
GET /api/runs/nonexistent_id
Authorization: Bearer <access_token>
```

**Response (404):**

```json
{
  "error": "Not Found",
  "message": "Run not found",
  "timestamp": "2024-01-19T10:30:00Z"
}
```

### Forbidden Error Example

**Request:**

```http
GET /api/runs/clm456ghi789
Authorization: Bearer <other_users_token>
```

**Response (403):**

```json
{
  "error": "Forbidden",
  "message": "You do not have permission to access this run",
  "timestamp": "2024-01-19T10:30:00Z"
}
```

### Rate Limit Error Example

**Request:**

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "wrong_password"
}
```

**Response (429) - After 5 failed attempts:**

```json
{
  "error": "Rate Limit Exceeded",
  "message": "Too many failed login attempts. Please try again in 15 minutes.",
  "timestamp": "2024-01-19T10:30:00Z"
}
```

## Curl Examples for Complete Workflows

### Complete User Registration and First Run

```bash
#!/bin/bash

# 1. Register new user
REGISTER_RESPONSE=$(curl -s -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newrunner@example.com",
    "password": "SecurePassword123!"
  }')

# Extract access token
ACCESS_TOKEN=$(echo $REGISTER_RESPONSE | jq -r '.accessToken')

# 2. Create a weekly distance goal
curl -X POST http://localhost:3001/api/goals \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "distance",
    "period": "weekly",
    "targetValue": 30.0,
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-12-31T23:59:59Z"
  }'

# 3. Log first run
curl -X POST http://localhost:3001/api/runs \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2024-01-19T07:00:00Z",
    "distance": 5.0,
    "duration": 1800,
    "runType": "easy",
    "notes": "First run with the new app!"
  }'

# 4. Check weekly stats
curl -X GET http://localhost:3001/api/stats/insights-summary \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Race Registration and Result Update

```bash
#!/bin/bash

# Assume we have ACCESS_TOKEN from previous authentication

# 1. Register for upcoming race
RACE_RESPONSE=$(curl -s -X POST http://localhost:3001/api/races \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "City Marathon 2024",
    "distance": 42.195,
    "raceDate": "2024-05-15T08:00:00Z",
    "targetTime": 11400,
    "location": "Downtown City",
    "notes": "First marathon attempt"
  }')

# Extract race ID
RACE_ID=$(echo $RACE_RESPONSE | jq -r '.id')

# 2. After race completion, update with results
curl -X PUT http://localhost:3001/api/races/$RACE_ID \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "actualTime": 11100,
    "notes": "Amazing experience! Finished faster than expected."
  }'

# 3. Get all races to see the updated result
curl -X GET http://localhost:3001/api/races \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

These examples demonstrate the complete functionality of the Running App MVP API with realistic data and use cases that developers can use for testing and integration.
