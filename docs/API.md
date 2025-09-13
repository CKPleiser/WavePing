# WavePing API Documentation

## Overview

WavePing exposes several API endpoints for webhook handling, CRON job execution, and testing. All endpoints use JSON for request/response bodies and include comprehensive error handling.

## Base URL

- **Development**: `http://localhost:3000`
- **Production**: `https://your-domain.railway.app`

## Authentication

### Webhook Endpoints
No authentication required - handled by Telegram's webhook validation.

### CRON Endpoints
Require `CRON_SECRET` header for security:
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
     -X POST https://your-domain.railway.app/api/cron/send-morning-digest
```

### Test Endpoints
Available only when `ENABLE_TESTING_ENDPOINTS=true` in development.

## Endpoints

### 🤖 Telegram Integration

#### POST /api/telegram/webhook
Receives updates from Telegram Bot API.

**Headers:**
- `Content-Type: application/json`

**Request Body:**
```json
{
  "update_id": 123456789,
  "message": {
    "message_id": 1,
    "from": {
      "id": 12345678,
      "is_bot": false,
      "first_name": "John",
      "username": "john_surfer"
    },
    "chat": {
      "id": 12345678,
      "first_name": "John",
      "username": "john_surfer",
      "type": "private"
    },
    "date": 1640995200,
    "text": "/start"
  }
}
```

**Response:**
```json
{
  "status": "success",
  "processed": true
}
```

**Error Responses:**
```json
{
  "status": "error",
  "message": "Invalid update format",
  "code": "INVALID_UPDATE"
}
```

### 📅 CRON Jobs

#### POST /api/cron/send-morning-digest
Sends morning digest (8 AM) to subscribed users.

**Headers:**
- `Authorization: Bearer CRON_SECRET`

**Response:**
```json
{
  "status": "success",
  "digestType": "morning",
  "usersProcessed": 145,
  "messagesSet": 98,
  "errors": []
}
```

#### POST /api/cron/send-evening-digest
Sends evening digest (6 PM) to subscribed users.

**Headers:**
- `Authorization: Bearer CRON_SECRET`

**Response:**
```json
{
  "status": "success",
  "digestType": "evening", 
  "usersProcessed": 167,
  "messagesSet": 134,
  "errors": []
}
```

#### POST /api/cron/send-session-notifications
Sends real-time notifications for newly available sessions.

**Headers:**
- `Authorization: Bearer CRON_SECRET`

**Response:**
```json
{
  "status": "success",
  "sessionsProcessed": 12,
  "notificationsSent": 45,
  "usersNotified": 32,
  "errors": []
}
```

### 🧪 Testing Endpoints

#### POST /api/test/notification
Send test notification to specific user (development only).

**Request Body:**
```json
{
  "telegramId": 12345678,
  "message": "Test notification message"
}
```

**Response:**
```json
{
  "status": "success",
  "messageId": 789,
  "telegramId": 12345678
}
```

#### POST /api/test/notification-system
Test the complete notification pipeline (development only).

**Request Body:**
```json
{
  "telegramId": 12345678,
  "sessionDate": "2024-01-15"
}
```

**Response:**
```json
{
  "status": "success",
  "testResults": {
    "userFound": true,
    "preferencesValid": true,
    "sessionsMatched": 3,
    "notificationSent": true
  }
}
```

### 🔍 Health & Status

#### GET /health
System health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "telegram": "connected",
    "scraper": "operational"
  }
}
```

## Error Handling

All endpoints return consistent error responses:

### Standard Error Format
```json
{
  "status": "error",
  "message": "Human readable error message",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "details": {
    "field": "Additional error context"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_REQUEST` | 400 | Malformed request body or parameters |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Endpoint or resource not found |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server-side error |
| `SERVICE_UNAVAILABLE` | 503 | Temporary service outage |

### Specific Error Codes

#### Telegram Errors
- `TELEGRAM_API_ERROR`: Telegram Bot API returned an error
- `WEBHOOK_VALIDATION_FAILED`: Invalid webhook payload
- `USER_BLOCKED_BOT`: User has blocked the bot
- `MESSAGE_TOO_LONG`: Message exceeds Telegram limits

#### Database Errors
- `DATABASE_CONNECTION_FAILED`: Cannot connect to Supabase
- `QUERY_TIMEOUT`: Database query exceeded timeout
- `CONSTRAINT_VIOLATION`: Database constraint validation failed
- `USER_NOT_FOUND`: User profile doesn't exist

#### Scraper Errors
- `SCRAPER_UNAVAILABLE`: Cannot access The Wave website
- `PARSE_ERROR`: Unable to parse session data
- `NO_SESSIONS_FOUND`: No sessions available for date range

## Rate Limiting

### Telegram API
- **Bot API**: 30 requests per second per bot
- **Webhook**: No explicit limits, but respect fair usage
- **Implementation**: Built-in rate limiting with queue management

### CRON Jobs
- **Digests**: Maximum once every 4 hours per type
- **Notifications**: Maximum once per minute
- **Rate Limiting**: IP-based with token bucket algorithm

### Testing Endpoints
- **General**: 10 requests per minute per IP in development
- **Notification Tests**: 5 requests per minute to prevent spam

## Request/Response Examples

### Successful Morning Digest
```bash
curl -X POST "https://your-domain.railway.app/api/cron/send-morning-digest" \
     -H "Authorization: Bearer your_cron_secret" \
     -H "Content-Type: application/json"
```

**Response:**
```json
{
  "status": "success",
  "digestType": "morning",
  "usersProcessed": 145,
  "messagesSet": 98,
  "processingTime": 2.5,
  "stats": {
    "usersWithPreferences": 145,
    "usersWithActiveSessions": 98,
    "averageSessionsPerUser": 3.2,
    "totalSessionsFound": 24
  },
  "errors": []
}
```

### Failed Notification with Details
```json
{
  "status": "error",
  "message": "Failed to send notifications",
  "code": "NOTIFICATION_BATCH_FAILED",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "details": {
    "totalAttempted": 50,
    "successful": 35,
    "failed": 15,
    "errors": [
      {
        "telegramId": 12345678,
        "error": "User blocked bot",
        "code": "USER_BLOCKED_BOT"
      },
      {
        "telegramId": 87654321,
        "error": "Message too long",
        "code": "MESSAGE_TOO_LONG"
      }
    ]
  }
}
```

## Webhook Configuration

### Setting Up Telegram Webhook
```bash
# Development (using ngrok)
npm run tunnel  # Start ngrok tunnel
npm run telegram:webhook  # Set webhook URL

# Production (Railway)
# Webhook is automatically configured in production
```

### Webhook Validation
- **Method**: POST only
- **Content-Type**: application/json
- **User-Agent**: Contains "TelegramBot"
- **X-Telegram-Bot-API-Secret-Token**: Optional validation header

### Security Considerations
- **HTTPS Required**: Webhook URLs must use HTTPS in production
- **IP Whitelist**: Only accept webhooks from Telegram's IP ranges
- **Request Validation**: Verify request structure and required fields
- **Rate Limiting**: Protect against abuse with request throttling

## Integration Examples

### Node.js Client
```javascript
const axios = require('axios');

class WavePingClient {
  constructor(baseURL, cronSecret) {
    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async sendMorningDigest() {
    try {
      const response = await this.client.post('/api/cron/send-morning-digest');
      return response.data;
    } catch (error) {
      console.error('Failed to send morning digest:', error.response?.data);
      throw error;
    }
  }

  async testNotification(telegramId, message) {
    const response = await this.client.post('/api/test/notification', {
      telegramId,
      message
    });
    return response.data;
  }
}
```

### CRON Job Setup
```bash
# Morning digest at 8 AM
0 8 * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-domain.railway.app/api/cron/send-morning-digest

# Evening digest at 6 PM  
0 18 * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-domain.railway.app/api/cron/send-evening-digest

# Session notifications every 5 minutes
*/5 * * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-domain.railway.app/api/cron/send-session-notifications
```

## Monitoring & Observability

### Health Checks
Monitor the `/health` endpoint for:
- **Database connectivity**: Supabase connection status
- **External services**: Telegram Bot API availability
- **Application metrics**: Response times, error rates

### Logging
Structured logging includes:
- **Request IDs**: Trace requests across services
- **User Context**: Telegram user ID, preferences
- **Performance**: Response times, query durations
- **Errors**: Stack traces, error codes, recovery actions

### Metrics Collection
Track key metrics:
- **API Performance**: Response times, throughput, error rates
- **User Engagement**: Active users, preferences configured, notifications sent
- **System Health**: Memory usage, database connections, external API calls