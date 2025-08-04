# Goals API currentValue Update Testing with curl

This document demonstrates testing the Goals API PUT endpoint for updating currentValue using curl commands.

## Prerequisites

1. Server running on http://localhost:3001
2. Valid JWT token for authentication
3. Existing goal to update

## Test Scenarios

### 1. Create a Test User and Get JWT Token

First, you'll need to authenticate and get a JWT token:

```bash
# Register a new user
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "password123"
  }'

# Login to get JWT token
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### 2. Create a Test Goal

```bash
# Replace YOUR_JWT_TOKEN with the actual token from login
curl -X POST http://localhost:3001/api/goals \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "title": "Run 100km this month",
    "description": "Monthly distance goal",
    "type": "DISTANCE",
    "period": "MONTHLY",
    "targetValue": 100,
    "targetUnit": "km",
    "startDate": "2024-01-01",
    "endDate": "2024-01-31"
  }'
```

### 3. Test currentValue Updates

#### Update currentValue to 25km

```bash
curl -X PUT http://localhost:3001/api/goals/GOAL_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "currentValue": 25
  }'
```

#### Update currentValue to 75km

```bash
curl -X PUT http://localhost:3001/api/goals/GOAL_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "currentValue": 75
  }'
```

#### Update currentValue to reach target (should auto-complete goal)

```bash
curl -X PUT http://localhost:3001/api/goals/GOAL_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "currentValue": 100
  }'
```

### 4. Test Validation (Should Return 400 Errors)

#### Try to set negative currentValue

```bash
curl -X PUT http://localhost:3001/api/goals/GOAL_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "currentValue": -5
  }'
```

### 5. Combined Updates

You can also update currentValue along with other fields:

```bash
curl -X PUT http://localhost:3001/api/goals/GOAL_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "title": "Updated Goal Title",
    "description": "Updated description",
    "currentValue": 50
  }'
```

## Expected Responses

### Successful currentValue Update

```json
{
  "id": "goal-uuid",
  "userId": "user-uuid",
  "title": "Run 100km this month",
  "description": "Monthly distance goal",
  "type": "DISTANCE",
  "period": "MONTHLY",
  "targetValue": 100,
  "targetUnit": "km",
  "currentValue": 25,
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-31T00:00:00.000Z",
  "isActive": true,
  "isCompleted": false,
  "completedAt": null,
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:05:00.000Z"
}
```

### Goal Auto-Completion (when currentValue >= targetValue)

```json
{
  "id": "goal-uuid",
  "userId": "user-uuid",
  "title": "Run 100km this month",
  "description": "Monthly distance goal",
  "type": "DISTANCE",
  "period": "MONTHLY",
  "targetValue": 100,
  "targetUnit": "km",
  "currentValue": 100,
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-31T00:00:00.000Z",
  "isActive": true,
  "isCompleted": true,
  "completedAt": "2024-01-15T10:10:00.000Z",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:10:00.000Z"
}
```

### Validation Error (negative currentValue)

```json
{
  "error": true,
  "message": "Current value cannot be negative",
  "statusCode": 400,
  "category": "validation",
  "timestamp": "2024-01-15T10:15:00.000Z",
  "path": "/api/goals/goal-uuid",
  "method": "PUT",
  "errorCode": "VALIDATION_ERROR",
  "field": "currentValue"
}
```

## Key Features Demonstrated

1. **currentValue Updates**: Successfully updating the currentValue field via PUT requests
2. **Auto-completion**: Goals are automatically marked as completed when currentValue reaches targetValue
3. **Validation**: Negative currentValue values are properly rejected with clear error messages
4. **Partial Updates**: Can update only currentValue or combine it with other field updates
5. **Authentication**: All endpoints require valid JWT authentication
6. **User Isolation**: Users can only update their own goals

## Test Coverage Summary

The integration tests and curl examples demonstrate that:

✅ currentValue can be successfully updated via PUT /api/goals/:id
✅ Goals are auto-completed when currentValue reaches targetValue
✅ Negative currentValue values are rejected with proper validation
✅ Combined updates (currentValue + other fields) work correctly
✅ Authentication is properly enforced
✅ User isolation is maintained (users can't update others' goals)
✅ Error handling returns proper HTTP status codes and error messages
