const https = require('https');

const TELEGRAM_BOT_TOKEN = '8498309436:AAF56MbM5aRXcTbYzcktNqLHJZRMtvm1Rwc';

console.log('🤖 Testing WavePing Bot...\n');

// Get bot info
const getMe = () => {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
};

// Get webhook info
const getWebhookInfo = () => {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
};

async function test() {
  try {
    // Check bot info
    const botInfo = await getMe();
    if (botInfo.ok) {
      console.log('✅ Bot is active!');
      console.log(`📱 Bot username: @${botInfo.result.username}`);
      console.log(`🏷️  Bot name: ${botInfo.result.first_name}`);
    } else {
      console.log('❌ Bot is not responding');
      return;
    }

    console.log('');

    // Check webhook
    const webhookInfo = await getWebhookInfo();
    if (webhookInfo.ok) {
      if (webhookInfo.result.url) {
        console.log('🔗 Webhook Configuration:');
        console.log(`   URL: ${webhookInfo.result.url}`);
        console.log(`   Pending updates: ${webhookInfo.result.pending_update_count || 0}`);
        
        if (webhookInfo.result.last_error_date) {
          const errorDate = new Date(webhookInfo.result.last_error_date * 1000);
          console.log(`   ⚠️  Last error: ${webhookInfo.result.last_error_message}`);
          console.log(`   Error date: ${errorDate.toLocaleString()}`);
        } else {
          console.log('   ✅ No recent errors');
        }
      } else {
        console.log('⚠️  No webhook configured');
        console.log('   Run: node scripts/update-webhook.js <your-railway-url>');
      }
    }

    console.log('\n📲 To test the bot:');
    console.log('1. Open Telegram');
    console.log('2. Search for @WavePingBot');
    console.log('3. Send /start');

  } catch (error) {
    console.error('❌ Error testing bot:', error.message);
  }
}

test();