const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting test server...');
console.log('Environment variables:');
console.log('PORT:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? 'SET' : 'NOT SET');

app.get('/', (req, res) => {
  console.log('Homepage hit');
  res.json({ 
    message: 'WavePing Test Server',
    status: 'running',
    port: PORT,
    env: process.env.NODE_ENV
  });
});

app.get('/health', (req, res) => {
  console.log('Health check hit');
  res.json({ status: 'healthy' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Test server running on port ${PORT}`);
  console.log(`🌐 Accessible at: http://0.0.0.0:${PORT}`);
});

// Error handling
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});