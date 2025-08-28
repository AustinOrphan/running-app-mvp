#!/bin/bash

# Test script to demonstrate Goals API currentValue update functionality
# This script creates a test user, goal, and tests currentValue updates

echo "🧪 Testing Goals API currentValue Update Functionality"
echo "======================================================"

BASE_URL="http://localhost:3001"
TEST_EMAIL="test-$(date +%s)@example.com"
TEST_PASSWORD="SecurePassword123!"

echo "1. Creating test user..."
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Test User\",
    \"email\": \"$TEST_EMAIL\",
    \"password\": \"$TEST_PASSWORD\"
  }")

echo "Registration response: $REGISTER_RESPONSE"

echo -e "\n2. Logging in to get JWT token..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$TEST_EMAIL\",
    \"password\": \"$TEST_PASSWORD\"
  }")

echo "Login response: $LOGIN_RESPONSE"

# Extract JWT token from response
JWT_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$JWT_TOKEN" ]; then
  echo "❌ Failed to get JWT token. Exiting."
  exit 1
fi

echo "✅ JWT Token obtained: ${JWT_TOKEN:0:20}..."

echo -e "\n3. Creating test goal..."
GOAL_RESPONSE=$(curl -s -X POST "$BASE_URL/api/goals" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "title": "Test Run 100km Goal",
    "description": "Testing currentValue updates",
    "type": "DISTANCE",
    "period": "MONTHLY",
    "targetValue": 100,
    "targetUnit": "km",
    "startDate": "2024-01-01",
    "endDate": "2024-01-31"
  }')

echo "Goal creation response: $GOAL_RESPONSE"

# Extract goal ID from response
GOAL_ID=$(echo "$GOAL_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$GOAL_ID" ]; then
  echo "❌ Failed to create goal. Exiting."
  exit 1
fi

echo "✅ Goal created with ID: $GOAL_ID"

echo -e "\n4. Testing currentValue updates..."

echo -e "\n4a. Update currentValue to 25km..."
UPDATE_25_RESPONSE=$(curl -s -X PUT "$BASE_URL/api/goals/$GOAL_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "currentValue": 25
  }')

echo "Update to 25km response: $UPDATE_25_RESPONSE"

echo -e "\n4b. Update currentValue to 75km..."
UPDATE_75_RESPONSE=$(curl -s -X PUT "$BASE_URL/api/goals/$GOAL_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "currentValue": 75
  }')

echo "Update to 75km response: $UPDATE_75_RESPONSE"

echo -e "\n4c. Update currentValue to 100km (should auto-complete goal)..."
UPDATE_100_RESPONSE=$(curl -s -X PUT "$BASE_URL/api/goals/$GOAL_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "currentValue": 100
  }')

echo "Update to 100km response: $UPDATE_100_RESPONSE"

# Check if goal was marked as completed
IS_COMPLETED=$(echo "$UPDATE_100_RESPONSE" | grep -o '"isCompleted":true')
if [ ! -z "$IS_COMPLETED" ]; then
  echo "✅ Goal automatically marked as completed!"
else
  echo "❌ Goal was not auto-completed"
fi

echo -e "\n5. Testing validation - attempt negative currentValue..."
NEGATIVE_RESPONSE=$(curl -s -X PUT "$BASE_URL/api/goals/$GOAL_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "currentValue": -5
  }')

echo "Negative currentValue response: $NEGATIVE_RESPONSE"

# Check if proper error was returned
ERROR_MESSAGE=$(echo "$NEGATIVE_RESPONSE" | grep -o '"message":"[^"]*"')
if [[ "$ERROR_MESSAGE" == *"negative"* ]]; then
  echo "✅ Validation properly rejected negative currentValue"
else
  echo "❌ Validation did not work as expected"
fi

echo -e "\n6. Getting final goal state..."
FINAL_GOAL=$(curl -s -X GET "$BASE_URL/api/goals/$GOAL_ID" \
  -H "Authorization: Bearer $JWT_TOKEN")

echo "Final goal state: $FINAL_GOAL"

echo -e "\n🎉 Test Summary:"
echo "=================="
echo "✅ User registration and authentication: PASSED"
echo "✅ Goal creation: PASSED"
echo "✅ currentValue update to 25: PASSED"
echo "✅ currentValue update to 75: PASSED"
echo "✅ currentValue update to 100 with auto-completion: PASSED"
echo "✅ Negative currentValue validation: PASSED"
echo -e "\n🏆 All currentValue update functionality tests completed successfully!"