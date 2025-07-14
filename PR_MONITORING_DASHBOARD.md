# 📊 PR Merge Monitoring Dashboard

## 🎯 Real-time Monitoring Guide

This dashboard provides comprehensive monitoring instructions for the PR merge process.

---

## 🔍 Key Performance Indicators (KPIs)

### Application Health Metrics

```yaml
Critical Thresholds:
  - Error Rate: < 0.1%
  - Response Time (P95): < 200ms
  - Uptime: > 99.9%
  - Memory Usage: < 80% of limit
  - CPU Usage: < 70% sustained
```

### Test Suite Health

```yaml
Test Metrics:
  - Pass Rate: 100%
  - Execution Time: < 5 minutes
  - Flaky Test Rate: < 1%
  - Coverage Delta: >= 0%
```

---

## 📈 Monitoring Queries & Commands

### 1. Application Error Monitoring

#### Check Error Logs:

```bash
# Recent application errors
kubectl logs -n running-app-staging -l app=running-app --since=1h | grep -E "(ERROR|FATAL|Exception)"

# Error count in last hour
kubectl logs -n running-app-staging -l app=running-app --since=1h | grep -c "ERROR"

# Specific error patterns
kubectl logs -n running-app-staging -l app=running-app --since=1h | grep -i "NaN"
```

#### Prometheus Queries:

```promql
# Error rate
sum(rate(http_requests_total{status=~"5..",app="running-app"}[5m]))
/
sum(rate(http_requests_total{app="running-app"}[5m]))

# Response time P95
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket{app="running-app"}[5m]))
  by (le)
)

# Request volume
sum(rate(http_requests_total{app="running-app"}[5m]))
```

### 2. Test Suite Monitoring

#### CI/CD Pipeline Status:

```bash
# Check latest workflow runs
gh run list --workflow=ci.yml --limit=10

# View specific run details
gh run view <run-id>

# Download test artifacts
gh run download <run-id> -n test-results
```

#### Test Execution Monitoring:

```bash
# Monitor test execution in real-time
npm run test:all -- --reporter=verbose

# Check for flaky tests
for i in {1..5}; do npm test && echo "Run $i: PASS" || echo "Run $i: FAIL"; done

# Coverage report
npm run test:coverage -- --reporter=json-summary
cat coverage/coverage-summary.json | jq '.total'
```

### 3. Performance Monitoring

#### Bundle Size Analysis:

```bash
# Analyze bundle size
npm run build
npm run analyze-bundle

# Compare with previous build
git checkout main
npm run build -- --stats
mv build/stats.json build/stats-main.json
git checkout pr-branch
npm run build -- --stats
npm run compare-builds build/stats-main.json build/stats.json
```

#### Memory & Performance:

```bash
# Pod resource usage
kubectl top pods -n running-app-staging -l app=running-app

# Node resource usage
kubectl top nodes

# Detailed memory analysis
kubectl exec -n running-app-staging deployment/running-app-backend -- \
  node --expose-gc --inspect=0.0.0.0:9229 & \
  npx clinic doctor -- node server.js
```

---

## 🚨 Alert Configuration

### Critical Alerts (Immediate Action)

```yaml
- name: HighErrorRate
  condition: error_rate > 1%
  duration: 5m
  action: Rollback immediately

- name: TestSuiteFailure
  condition: ci_test_pass_rate < 100%
  duration: immediate
  action: Block further merges

- name: MemoryLeak
  condition: memory_growth > 10% per hour
  duration: 30m
  action: Investigate and consider rollback
```

### Warning Alerts (Monitor Closely)

```yaml
- name: SlowResponseTime
  condition: p95_latency > 150ms
  duration: 10m
  action: Investigate performance

- name: IncreasedErrorRate
  condition: error_rate > 0.5%
  duration: 10m
  action: Monitor and prepare rollback

- name: TestFlakiness
  condition: flaky_test_rate > 2%
  duration: 3 runs
  action: Disable flaky tests
```

---

## 📊 Grafana Dashboard Setup

### Essential Panels:

1. **PR Merge Timeline**
   - Shows merge events with annotations
   - Correlates with metric changes

2. **Error Rate Panel**

   ```json
   {
     "targets": [
       {
         "expr": "sum(rate(http_requests_total{status=~'5..'}[5m])) by (endpoint)"
       }
     ],
     "alert": {
       "conditions": [
         {
           "evaluator": { "params": [0.01], "type": "gt" }
         }
       ]
     }
   }
   ```

3. **Test Suite Health**
   - Pass/fail rates
   - Execution time trends
   - Coverage changes

4. **Application Performance**
   - Request latency histogram
   - Throughput
   - Resource utilization

---

## 🔄 Automated Monitoring Scripts

### Health Check Loop:

```bash
#!/bin/bash
# health-monitor.sh

while true; do
  echo "=== Health Check $(date) ==="

  # API Health
  curl -s https://api.running-app.staging/health | jq '.'

  # Error count
  ERROR_COUNT=$(kubectl logs -n running-app-staging -l app=running-app --since=5m | grep -c ERROR)
  echo "Errors in last 5m: $ERROR_COUNT"

  # Response time
  curl -w "@curl-format.txt" -o /dev/null -s https://api.running-app.staging/api/runs

  sleep 60
done
```

### Test Suite Monitor:

```bash
#!/bin/bash
# test-monitor.sh

# Monitor CI status
while true; do
  LATEST_RUN=$(gh run list --workflow=ci.yml --limit=1 --json status,conclusion -q '.[0]')
  STATUS=$(echo $LATEST_RUN | jq -r '.status')
  CONCLUSION=$(echo $LATEST_RUN | jq -r '.conclusion')

  echo "CI Status: $STATUS, Conclusion: $CONCLUSION"

  if [[ "$CONCLUSION" == "failure" ]]; then
    echo "⚠️  CI FAILED - Investigate immediately!"
    # Send alert
  fi

  sleep 30
done
```

---

## 📱 Mobile/Slack Notifications

### Slack Webhook Integration:

```bash
# Send merge status
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"✅ PR #293 merged successfully - Monitoring for issues"}' \
  $SLACK_WEBHOOK_URL

# Send alert
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"🚨 High error rate detected after PR #293 merge!"}' \
  $SLACK_WEBHOOK_URL
```

### PagerDuty Integration:

```bash
# Trigger incident if critical threshold breached
if [[ $ERROR_RATE > 1 ]]; then
  curl -X POST https://api.pagerduty.com/incidents \
    -H 'Authorization: Token token=$PAGERDUTY_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{
      "incident": {
        "type": "incident",
        "title": "High error rate after PR merge",
        "service": {"id": "YOUR_SERVICE_ID"},
        "urgency": "high"
      }
    }'
fi
```

---

## 📈 Post-Merge Metrics Collection

### Generate Merge Report:

```bash
#!/bin/bash
# merge-report.sh

echo "# PR Merge Report - $(date)"
echo ""
echo "## Merged PRs"
gh pr list --state merged --limit 11 --json number,title,mergedAt

echo ""
echo "## Performance Impact"
echo "- Bundle Size: $(du -sh build | cut -f1)"
echo "- Test Duration: $(npm test -- --json | jq '.time')"
echo "- Error Rate: $(calculate_error_rate)"

echo ""
echo "## Test Results"
npm test -- --json | jq '.numPassedTests, .numFailedTests, .numTotalTests'
```

---

## 🎯 Quick Action Playbook

### If Error Rate Spikes:

1. Check error logs for patterns
2. Identify which PR likely caused issue
3. Prepare rollback command
4. Notify team
5. Execute rollback if > 1%

### If Tests Start Failing:

1. Re-run to confirm not flaky
2. Check which tests are failing
3. Identify related PR
4. Either fix forward or rollback
5. Update test documentation

### If Performance Degrades:

1. Check response time metrics
2. Profile application
3. Compare with baseline
4. Identify bottleneck
5. Plan optimization or rollback

---

## 📋 Monitoring Checklist

### Every 15 minutes:

- [ ] Check error rates
- [ ] Verify test suite passing
- [ ] Monitor response times
- [ ] Check resource usage

### Every hour:

- [ ] Review full metrics dashboard
- [ ] Check for any alerts
- [ ] Verify no memory leaks
- [ ] Confirm bundle size stable

### End of merge window:

- [ ] Generate comprehensive report
- [ ] Document any issues
- [ ] Update monitoring thresholds
- [ ] Plan follow-up actions

---

## 🔗 Quick Links

- **Grafana**: `https://grafana.example.com/d/running-app`
- **CI/CD**: `https://github.com/org/running-app-mvp/actions`
- **Logs**: `kubectl logs -n running-app-staging -f`
- **Alerts**: `https://alerts.example.com`

---

**Remember**: Early detection prevents major incidents. Monitor proactively!
