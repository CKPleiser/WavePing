# WavePing 🌊

**Smart Telegram bot for The Wave Bristol surf session alerts**

[![Node.js](https://img.shields.io/badge/node.js-20%2B-brightgreen)](https://nodejs.org/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot%20API-blue)](https://core.telegram.org/bots/api)
[![Supabase](https://img.shields.io/badge/Database-Supabase-green)](https://supabase.com/)
[![Railway](https://img.shields.io/badge/Deploy-Railway-purple)](https://railway.app/)

WavePing is an intelligent Telegram bot that provides personalized surf session notifications for [The Wave Bristol](https://thewave.com/bristol). Never miss your perfect wave again with smart filtering based on your skill level, availability, and preferences.

## ✨ Features

### 🎯 **Smart Session Matching**
- **Multi-level filtering**: Match by skill level, wave side, days, time windows, and minimum spots
- **Real-time availability**: Get notified the moment sessions with your preferences become available
- **Deduplication system**: No spam - each relevant session notified only once

### 📱 **Intelligent Notifications**
- **Instant alerts**: Real-time notifications when matching sessions have spots
- **Daily digests**: Morning (8 AM) and evening (6 PM) summaries of available sessions
- **Custom timing**: Choose when you want to receive your daily surf summaries
- **Profile overview**: View all your current preferences in one place

### 🏄‍♂️ **Comprehensive Preferences**
- **Skill Levels**: Beginner, Improver, Intermediate, Advanced, Expert
- **Wave Sides**: Left, Right, or Any preference
- **Time Windows**: Multiple time ranges (e.g., morning + evening sessions)
- **Days**: Specific days of the week
- **Minimum Spots**: Only get alerts when enough spots are available

### 🚀 **User Experience**
- **Interactive setup**: Guided onboarding for new users
- **One-button preferences**: Easy preference management with save/cancel options
- **Session browsing**: Check today's and tomorrow's sessions anytime
- **Profile management**: View and edit your complete profile

## 🚦 Quick Start

### For Users
1. Start a chat with [@WavePingBot](https://t.me/WavePingBot) on Telegram
2. Send `/start` to begin setup
3. Configure your surf preferences using the interactive menus
4. Receive personalized notifications when your perfect sessions become available!

### For Developers

#### Prerequisites
- Node.js 20+ 
- Supabase account and project
- Telegram Bot Token (via [@BotFather](https://t.me/botfather))

#### Installation
```bash
git clone https://github.com/YourUsername/waveping.git
cd waveping
npm install
```

#### Configuration
Create a `.env` file:
```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_WEBHOOK_DOMAIN=your_webhook_domain

# Supabase
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Application
NODE_ENV=development
PORT=3000
CRON_SECRET=your_secure_cron_secret

# Features (optional)
ENABLE_DIGESTS=true
ENABLE_SESSION_NOTIFICATIONS=true
ENABLE_TESTING_ENDPOINTS=false
```

#### Database Setup
```bash
# Initialize Supabase (if not already done)
npx supabase init

# Push database schema
npm run db:push

# Validate environment
npm run validate
```

#### Development
```bash
# Start development server (polling mode)
npm run dev

# Run tests
npm run test

# Test with coverage
npm run test:coverage
```

#### Production Deployment
```bash
# Set webhook (production)
npm run telegram:webhook

# Start production server
npm start
```

## 🏗️ Architecture

### Project Structure
```
waveping/
├── bot/                    # Core bot logic
│   ├── index.js           # Bot handler orchestration
│   ├── commands.js        # Command implementations (/start, /today, etc.)
│   ├── callbacks.js       # Interactive button handlers
│   ├── menus.js          # Inline keyboard menus
│   └── ui.js             # User interface messages
├── config/               # Configuration management
├── lib/                  # Core libraries
│   ├── database/         # Query optimization
│   ├── supabase/         # Database client
│   └── wave-scraper-final.js  # Web scraping engine
├── middleware/           # Express middleware
├── services/            # Business logic services  
├── supabase/           # Database schema & migrations
├── utils/              # Utility functions
├── scripts/            # Maintenance & setup scripts
└── tests/              # Test suite
```

### Key Components

#### 🤖 **Bot Handler (`/bot`)**
- **Commands**: Handle Telegram commands (`/start`, `/today`, `/prefs`)
- **Callbacks**: Process inline keyboard button presses
- **Menus**: Generate dynamic interactive menus
- **UI**: Craft beautiful, informative messages

#### 🌐 **Web Scraper (`/lib/wave-scraper-final.js`)**
- Scrapes The Wave Bristol's schedule
- Handles timezone conversion (Europe/London)
- Extracts session details (time, level, side, spots available)
- Supports date filtering and future sessions

#### 💾 **Database Layer (`/lib/supabase`)**
- User profile management
- Preference storage and retrieval
- Session data caching
- Notification deduplication
- Attendance tracking

#### 🔔 **Notification System (`/services`)**
- Real-time session alerts
- Daily digest generation
- Smart user-session matching
- Duplicate prevention

#### 🌊 **API Endpoints (`/server.js`)**
- Telegram webhook handling
- CRON job endpoints for digests
- Test endpoints for debugging
- Health checks and monitoring

## 🗄️ Database Schema

### Core Tables
- **profiles**: User accounts with Telegram integration
- **user_levels**: Skill level preferences (many-to-many)
- **user_sides**: Wave side preferences  
- **user_days**: Day-of-week availability
- **user_time_windows**: Time range preferences
- **user_notifications**: Notification timing settings
- **sessions**: Scraped session data with availability
- **notifications_sent**: Deduplication tracking

### Key Functions
- `get_users_for_digest()`: Returns digest subscribers
- `get_users_for_session_notification()`: Matches users to sessions
- `update_user_streak()`: Tracks attendance patterns

## 🛠️ API Reference

### Bot Commands
- `/start` - Begin setup or show main menu
- `/today` - View today's available sessions
- `/tomorrow` - Preview tomorrow's sessions  
- `/prefs` - Manage your preferences
- `/notifications` - Configure notification settings
- `/help` - Get help and support info
- `/support` - Support the developer

### Webhook Endpoints
- `POST /api/telegram/webhook` - Telegram bot updates
- `POST /api/cron/send-morning-digest` - 8 AM digest (authenticated)
- `POST /api/cron/send-evening-digest` - 6 PM digest (authenticated)
- `POST /api/cron/send-session-notifications` - Real-time alerts (authenticated)

### Test Endpoints (Development Only)
- `POST /api/test/notification` - Send test notification
- `POST /api/test/notification-system` - Test notification pipeline

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Validate environment setup
npm run validate
```

### Test Coverage
- **Middleware**: Authentication and error handling
- **Services**: Digest and notification services  
- **Utilities**: Telegram helper functions
- **Integration**: End-to-end workflow testing

## 🚀 Deployment

### Railway (Recommended)
1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on push to main branch

### Environment Configuration
- **Development**: Bot polling mode, local development
- **Production**: Webhook mode, optimized for deployment
- **Feature Flags**: Enable/disable digests, notifications, testing

### Monitoring
- **Health Checks**: Built-in endpoint monitoring
- **Error Tracking**: Comprehensive error logging
- **Performance**: Response time and throughput monitoring

## 📊 Recent Updates

### Latest Features (v1.0.0)
- ✅ **Daily Digest Timing Preferences** - Choose specific times for daily summaries
- ✅ **Current Profile Display** - View all preferences in one comprehensive overview
- ✅ **Enhanced User Interface** - Improved menu navigation and visual feedback
- ✅ **Interactive Main Menu** - Streamlined user experience with direct navigation
- ✅ **Preference Management** - One-click editing with save/cancel workflow

### Technical Improvements
- 🔧 **Time Format Standardization** - Consistent time window parsing
- 🔧 **Callback Data Optimization** - Improved button interaction handling
- 🔧 **Database Query Optimization** - Enhanced performance for user matching
- 🔧 **Error Handling** - Robust error recovery and user feedback

## 🤝 Contributing

We welcome contributions! Please see our [contributing guidelines](CONTRIBUTING.md) for details.

### Development Workflow
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass (`npm test`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to your branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Code Style
- Follow ESLint configuration
- Write meaningful commit messages
- Add JSDoc comments for functions
- Include tests for new features

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Users
- 📧 Email: [support@waveping.app](mailto:support@waveping.app)
- 💬 Telegram: [@WavePingSupport](https://t.me/WavePingSupport)
- 🐦 Twitter: [@WavePingBot](https://twitter.com/WavePingBot)

### Developers
- 🐛 Report issues: [GitHub Issues](https://github.com/YourUsername/waveping/issues)
- 💡 Feature requests: [GitHub Discussions](https://github.com/YourUsername/waveping/discussions)
- 📚 Documentation: [Project Wiki](https://github.com/YourUsername/waveping/wiki)

## ☕ Supporting WavePing

If WavePing helps you catch more waves, consider supporting development:

- ☕ [Buy Me a Coffee](https://buymeacoffee.com/waveping)
- 💖 [GitHub Sponsors](https://github.com/sponsors/waveping)
- ⭐ Star this repository
- 🔄 Share with fellow surfers

---

**Built with ❤️ by the WavePing team**

*Never miss your perfect wave again! 🏄‍♂️🌊*