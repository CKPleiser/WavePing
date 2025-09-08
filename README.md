# 🌊 WavePing

Smart Telegram bot for The Wave Bristol surf session alerts with real-time notifications and weather integration.

## Features

- 🏄‍♂️ **Smart Filtering**: Get alerts only for sessions matching your level, preferred side, and schedule
- ⏰ **Flexible Notifications**: Choose from 1 week to 2 hours advance notice
- 🌡️ **Weather Integration**: Water temperature, air conditions, and wind data
- 📱 **Telegram Bot**: Easy setup through conversational interface
- 🔄 **Real-time Updates**: Get notified when spots become available or sessions fill up
- 📊 **Session Tracking**: Track your surf sessions and build streaks

## Tech Stack

- **Frontend**: Next.js 14 with TypeScript
- **Backend**: Vercel Edge Functions
- **Database**: Supabase (PostgreSQL with real-time)
- **Bot**: Telegraf.js for Telegram integration
- **Scraping**: Cheerio for The Wave schedule parsing
- **Weather**: OpenWeatherMap API
- **CI/CD**: GitHub Actions with automated deployments

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase account
- Telegram Bot Token
- OpenWeatherMap API key (optional)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/waveping.git
   cd waveping
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

4. **Initialize Supabase**
   ```bash
   npx supabase init
   npx supabase start
   npx supabase db push
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

6. **Setup Telegram webhook (for local testing)**
   ```bash
   # Start ngrok in another terminal
   npx ngrok http 3000
   
   # Set the webhook URL
   export TELEGRAM_WEBHOOK_URL="https://your-ngrok-url.ngrok.io/api/telegram/webhook"
   npm run telegram:webhook
   ```

### Deployment

The project automatically deploys to Vercel on pushes to main branch.

#### Required Secrets

Set these in your GitHub repository secrets:

- `VERCEL_TOKEN` - Vercel deployment token
- `VERCEL_ORG_ID` - Your Vercel organization ID
- `VERCEL_PROJECT_ID` - Your Vercel project ID
- `SUPABASE_ACCESS_TOKEN` - Supabase access token
- `SUPABASE_PROJECT_REF` - Your Supabase project reference
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `VERCEL_DOMAIN` - Your production domain (e.g., waveping.vercel.app)

#### Environment Variables

Set these in your Vercel project settings:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Telegram
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_WEBHOOK_URL=https://your-domain.vercel.app/api/telegram/webhook

# Weather (optional)
OPENWEATHERMAP_API_KEY=your-weather-api-key

# Security
CRON_SECRET=your-random-secret-for-cron-jobs
```

## Usage

### Bot Commands

- `/start` - Welcome and setup your preferences
- `/setup` - Configure your alert preferences
- `/prefs` - View and edit current preferences
- `/today` - Today's matching sessions
- `/tomorrow` - Tomorrow's sessions
- `/week` - 7-day outlook
- `/stoke` - Get motivated with surf wisdom
- `/help` - Show all available commands

### Preference Setup

The bot will guide you through setting up:

1. **Session Levels**: Choose from Beginner to Expert Barrels
2. **Preferred Side**: Left, Right, or Any
3. **Available Days**: Specific days or any day
4. **Time Windows**: Morning, afternoon, evening, or any time
5. **Notification Timing**: 1 week to 2 hours before sessions

## API Endpoints

- `GET /api/health` - Health check endpoint
- `POST /api/telegram/webhook` - Telegram bot webhook
- `POST /api/cron/scrape-schedule` - Scheduled scraping (every 30min)
- `POST /api/cron/send-notifications` - Notification processing (every 15min)
- `POST /api/cron/update-weather` - Weather data update (hourly)

## Database Schema

The app uses Supabase with the following main tables:

- `profiles` - User accounts linked to Telegram IDs
- `sessions` - Scraped session data from The Wave
- `user_levels/sides/days/time_windows/notifications` - User preferences
- `user_sessions` - Session attendance tracking
- `notifications_sent` - Notification delivery tracking
- `weather_cache` - Weather data cache

## Development

### Testing the Scraper

```bash
# Test the Wave scraper
cd lib/scraper
node -r ts-node/register wave-scraper.ts
```

### Manual Cron Jobs

```bash
# Test schedule scraping
curl -X POST http://localhost:3000/api/cron/scrape-schedule \
  -H "Authorization: Bearer your-cron-secret"

# Test notifications
curl -X POST http://localhost:3000/api/cron/send-notifications \
  -H "Authorization: Bearer your-cron-secret"
```

### Database Migrations

```bash
# Create new migration
npx supabase migration new your_migration_name

# Push migrations
npx supabase db push

# Reset local database
npx supabase db reset
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -m 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a pull request

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Telegram Bot  │───▶│  Vercel APIs     │───▶│   Supabase DB   │
│   (User Input)  │    │  (Edge Functions)│    │   (PostgreSQL)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  The Wave Site  │◀───│  Cron Jobs       │───▶│  Weather API    │
│  (Scraping)     │    │  (Scheduled)     │    │  (OpenWeather)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## License

MIT License - see LICENSE file for details.

## Support

- Create an [issue](https://github.com/yourusername/waveping/issues) for bug reports
- Join our [discussions](https://github.com/yourusername/waveping/discussions) for questions
- Follow [@WavePingBot](https://t.me/WavePingBot) for updates

---

Built with ❤️ for the Bristol surf community 🏄‍♂️