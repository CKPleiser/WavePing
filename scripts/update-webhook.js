const https = require('https');

// Get Railway URL from command line argument
const railwayUrl = process.argv[2];

if (!railwayUrl) {
  console.error('❌ Please provide your Railway URL');
  console.error('Usage: node scripts/update-webhook.js <your-railway-url>');
  console.error('Example: node scripts/update-webhook.js https://waveping-production.up.railway.app');
  process.exit(1);
}

const TELEGRAM_BOT_TOKEN = '8498309436:AAF56MbM5aRXcTbYzcktNqLHJZRMtvm1Rwc';
const webhookUrl = `${railwayUrl}/api/telegram/webhook`;

console.log('🔗 Setting Telegram webhook to:', webhookUrl);

const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

https.get(url, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    const response = JSON.parse(data);
    
    if (response.ok) {
      console.log('✅ Webhook set successfully!');
      console.log('📱 Your bot is now connected to Railway');
      console.log('');
      console.log('🧪 Test your bot:');
      console.log('1. Open Telegram and search for @WavePingBot');
      console.log('2. Send /start to begin');
      console.log('3. The bot should respond with a welcome message');
    } else {
      console.error('❌ Failed to set webhook:', response.description);
    }
  });
}).on('error', (err) => {
  console.error('❌ Error setting webhook:', err.message);
});