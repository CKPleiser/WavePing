const https = require('https');

// Get Railway URL from command line argument
const railwayUrl = process.argv[2];

if (!railwayUrl) {
  console.error('❌ Please provide your Railway URL');
  console.error('Usage: node scripts/test-deployment.js <your-railway-url>');
  console.error('Example: node scripts/test-deployment.js https://waveping-production.up.railway.app');
  process.exit(1);
}

console.log('🧪 Testing WavePing deployment...\n');

const testEndpoint = (path, description) => {
  return new Promise((resolve) => {
    const url = `${railwayUrl}${path}`;
    console.log(`Testing: ${description}`);
    console.log(`URL: ${url}`);
    
    https.get(url, (res) => {
      console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ Success\n');
        } else {
          console.log('❌ Failed');
          console.log(`Response: ${data.substring(0, 200)}...\n`);
        }
        resolve();
      });
    }).on('error', (err) => {
      console.log(`❌ Error: ${err.message}\n`);
      resolve();
    });
  });
};

async function testAll() {
  await testEndpoint('/', 'Homepage');
  await testEndpoint('/api/health', 'Health check');
  await testEndpoint('/api/telegram/webhook', 'Telegram webhook endpoint');
  
  console.log('🎯 Next steps:');
  console.log('1. If all endpoints are working, update your Telegram webhook:');
  console.log(`   node scripts/update-webhook.js ${railwayUrl}`);
  console.log('2. Test your bot in Telegram by sending /start to @WavePingBot');
}

testAll();