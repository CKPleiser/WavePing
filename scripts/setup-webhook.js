// Script to setup Telegram webhook for local development
const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL || 'https://your-ngrok-url.ngrok.io/api/telegram/webhook';

if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;

const data = JSON.stringify({
  url: WEBHOOK_URL
});

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log(`Setting webhook to: ${WEBHOOK_URL}`);

const req = https.request(telegramApiUrl, options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    const response = JSON.parse(responseData);
    if (response.ok) {
      console.log('✅ Webhook set successfully!');
      console.log('Webhook info:', response.result);
    } else {
      console.error('❌ Failed to set webhook:', response);
    }
  });
});

req.on('error', (error) => {
  console.error('Error setting webhook:', error);
});

req.write(data);
req.end();