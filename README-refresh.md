# Database Refresh Instructions

## Problem
The bot is showing outdated session data that doesn't match The Wave website. The scraper works correctly, but the database has stale data.

## Solution
Run the database refresh script on Railway to clear old data and fetch fresh sessions.

## Steps to Refresh Database on Railway

### Option 1: Using Railway CLI
```bash
# Install Railway CLI if not already installed
npm install -g @railway/cli

# Login and connect to your project
railway login
railway link

# Run the refresh script
railway run node scripts/refresh-database.js
```

### Option 2: Using Railway Dashboard
1. Go to your Railway project dashboard
2. Open the deployment logs/terminal
3. Run: `node scripts/refresh-database.js`

### Option 3: Trigger via Cron Endpoint
```bash
# Use your actual CRON_SECRET from Railway environment
curl -X POST "https://waveping-production.up.railway.app/api/cron/scrape-schedule" \
  -H "Authorization: Bearer YOUR_CRON_SECRET_HERE" \
  -H "Content-Type: application/json"
```

## What the Script Does
1. ✅ Clears all sessions from today onwards
2. ✅ Uses the improved scraper to fetch 14 days of sessions (388 sessions)
3. ✅ Inserts fresh data with correct levels, sides, and spot counts
4. ✅ Shows verification output

## Expected Results
After running the refresh, the bot should show:
- **15:00**: Advanced Surf (L) 13 spots, Advanced Surf (R) 1 spot, Intermediate sessions, Beginner sessions
- **15:30**: Intermediate Surf With Lesson (L) 2 spots, (R) 2 spots
- **16:00**: Multiple sessions including Intermediate (L/R) 11 spots, Beginner 22 spots

This matches exactly what The Wave website shows in your screenshot.