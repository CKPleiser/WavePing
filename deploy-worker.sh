#!/bin/bash

echo "🚀 Deploying WavePing Bot to Cloudflare Workers..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install --package-lock-only --package-lock-only --save-exact @supabase/supabase-js@2.39.0
npm install -D wrangler@3.0.0

# Deploy to Cloudflare Workers
echo "☁️ Deploying to Cloudflare Workers..."
npx wrangler deploy

# Get the worker URL
WORKER_URL=$(npx wrangler subdomain get | grep -o 'https://[^/]*' | head -1)
if [ -z "$WORKER_URL" ]; then
    echo "⚠️ Could not get worker URL. Please check your Cloudflare setup."
    echo "Your worker should be available at: https://waveping-bot.YOUR_SUBDOMAIN.workers.dev"
    WORKER_URL="https://waveping-bot.YOUR_SUBDOMAIN.workers.dev"
fi

WEBHOOK_URL="$WORKER_URL/webhook"
echo "🔗 Setting Telegram webhook to: $WEBHOOK_URL"

# Set Telegram webhook
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$WEBHOOK_URL\"}"

echo ""
echo "✅ Deployment complete!"
echo "🌐 Worker URL: $WORKER_URL" 
echo "📱 Webhook URL: $WEBHOOK_URL"
echo "🤖 Your bot should now be running on Cloudflare Workers!"
echo ""
echo "Test with: /start in your Telegram bot"