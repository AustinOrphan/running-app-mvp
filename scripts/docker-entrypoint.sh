#!/bin/sh
set -e

echo "🚀 Starting Running App..."

# Function to wait for database
wait_for_db() {
  echo "⏳ Waiting for database connection..."
  max_retries=30
  retry_count=0
  
  while [ $retry_count -lt $max_retries ]; do
    if npx prisma db push --skip-generate > /dev/null 2>&1; then
      echo "✅ Database connection established"
      return 0
    fi
    
    retry_count=$((retry_count + 1))
    echo "⏳ Waiting for database... (attempt $retry_count/$max_retries)"
    sleep 2
  done
  
  echo "❌ Failed to connect to database after $max_retries attempts"
  exit 1
}

# Function to run migrations
run_migrations() {
  echo "🔄 Running database migrations..."
  if npx prisma migrate deploy; then
    echo "✅ Migrations completed successfully"
  else
    echo "❌ Migration failed"
    exit 1
  fi
}

# Environment validation
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  exit 1
fi

if [ -z "$JWT_SECRET" ]; then
  echo "❌ ERROR: JWT_SECRET environment variable is not set"
  exit 1
fi

# Handle different deployment scenarios
case "${DEPLOYMENT_MODE:-production}" in
  "development")
    echo "🔧 Running in development mode"
    wait_for_db
    npx prisma db push --skip-generate
    ;;
  "staging")
    echo "🔧 Running in staging mode"
    wait_for_db
    run_migrations
    ;;
  "production")
    echo "🔧 Running in production mode"
    wait_for_db
    run_migrations
    ;;
  *)
    echo "❌ Unknown deployment mode: ${DEPLOYMENT_MODE}"
    exit 1
    ;;
esac

# Start the application
echo "🚀 Starting server on port ${PORT:-3001}..."
exec node server.js