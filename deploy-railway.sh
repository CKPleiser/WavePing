#!/bin/bash

echo "🚀 Deploying WavePing to Railway..."

# Set Railway API token
export RAILWAY_TOKEN="56fdb3f6-1c93-4f81-bee0-574481689485"

# Check if project is linked
if [ ! -f ".railway/config.json" ]; then
    echo "❌ No Railway project linked. Please link your project first:"
    echo "   railway link"
    exit 1
fi

echo "📦 Building application..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please fix errors and try again."
    exit 1
fi

echo "🚂 Deploying to Railway..."
railway up

if [ $? -eq 0 ]; then
    echo "✅ Deployment successful!"
    echo ""
    echo "🔗 Your app should be available at your Railway domain"
    echo "📱 Don't forget to update the Telegram webhook URL!"
else
    echo "❌ Deployment failed. Check Railway dashboard for details."
    exit 1
fi