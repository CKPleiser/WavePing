# Railway Cron Setup for WavePing

## Overview
Railway doesn't have built-in cron jobs, so we need to use an external cron service or Railway's cron addon.

## Option 1: External Cron Service (Recommended)

### Using cron-job.org or similar:

1. **Schedule Scraper** (every 30 minutes):
   - URL: `https://your-railway-app.up.railway.app/api/cron/scrape-schedule`
   - Method: POST
   - Headers: `Authorization: Bearer your-cron-secret`
   - Schedule: `*/30 * * * *`

2. **Schedule Notifications** (every 15 minutes):
   - URL: `https://your-railway-app.up.railway.app/api/cron/send-notifications`  
   - Method: POST
   - Headers: `Authorization: Bearer your-cron-secret`
   - Schedule: `*/15 * * * *`

3. **Schedule Weather Updates** (hourly):
   - URL: `https://your-railway-app.up.railway.app/api/cron/update-weather`
   - Method: POST  
   - Headers: `Authorization: Bearer your-cron-secret`
   - Schedule: `0 * * * *`

## Option 2: Railway Cron Plugin

If Railway offers a cron plugin, configure it to call these endpoints with the CRON_SECRET.

## Environment Variables Required

Make sure these are set in Railway:
- `CRON_SECRET`: A secure random string for cron authentication
- All other environment variables from `.env.local`

## Testing

Test the endpoints manually first:
```bash
curl -X POST https://your-app.up.railway.app/api/cron/scrape-schedule \
  -H "Authorization: Bearer your-cron-secret"
```

## Fixed Issues

✅ Database field mapping corrected
✅ Scraper data format matches database schema  
✅ Level and side fields will now populate correctly