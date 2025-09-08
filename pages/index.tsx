import Head from 'next/head'
import Link from 'next/link'

export default function Home() {
  return (
    <>
      <Head>
        <title>WavePing - Smart Surf Alerts for The Wave Bristol</title>
        <meta name="description" content="Get personalized surf session alerts for The Wave Bristol via Telegram" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-cyan-50 to-teal-50">
        <div className="container mx-auto px-4 py-16">
          {/* Hero Section */}
          <div className="text-center mb-16">
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              🌊 WavePing
            </h1>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Smart Telegram bot for The Wave Bristol surf session alerts. 
              Get notified about sessions that match your level, schedule, and preferences.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="https://t.me/WavePingBot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                <span className="mr-2">🤖</span>
                Start Using Bot
              </a>
              
              <Link
                href="/dashboard"
                className="inline-flex items-center px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
              >
                <span className="mr-2">📊</span>
                View Dashboard
              </Link>
            </div>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <div className="bg-white rounded-xl p-6 shadow-sm border">
              <div className="text-3xl mb-4">🎯</div>
              <h3 className="text-lg font-semibold mb-2">Smart Filtering</h3>
              <p className="text-gray-600">
                Only get alerts for sessions matching your skill level, preferred side, and available times.
              </p>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm border">
              <div className="text-3xl mb-4">⏰</div>
              <h3 className="text-lg font-semibold mb-2">Flexible Timing</h3>
              <p className="text-gray-600">
                Choose when to be notified - from 1 week to 2 hours before your perfect session.
              </p>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm border">
              <div className="text-3xl mb-4">🌡️</div>
              <h3 className="text-lg font-semibold mb-2">Weather Integrated</h3>
              <p className="text-gray-600">
                Get water temperature, air conditions, and wind data with every alert.
              </p>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm border">
              <div className="text-3xl mb-4">🔄</div>
              <h3 className="text-lg font-semibold mb-2">Real-time Updates</h3>
              <p className="text-gray-600">
                Instant notifications when spots become available or sessions fill up quickly.
              </p>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm border">
              <div className="text-3xl mb-4">📱</div>
              <h3 className="text-lg font-semibold mb-2">Easy Setup</h3>
              <p className="text-gray-600">
                Simple conversational setup through Telegram - no app downloads required.
              </p>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm border">
              <div className="text-3xl mb-4">📊</div>
              <h3 className="text-lg font-semibold mb-2">Track Progress</h3>
              <p className="text-gray-600">
                Build surf streaks and track your sessions to stay motivated and consistent.
              </p>
            </div>
          </div>

          {/* How it Works */}
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-8">How It Works</h2>
            
            <div className="flex flex-col md:flex-row justify-center items-center gap-8">
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-3">
                  <span className="text-xl">1</span>
                </div>
                <h3 className="font-semibold mb-2">Start the Bot</h3>
                <p className="text-gray-600 text-center max-w-xs">
                  Message @WavePingBot on Telegram and run /start
                </p>
              </div>

              <div className="hidden md:block text-gray-400">→</div>

              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-3">
                  <span className="text-xl">2</span>
                </div>
                <h3 className="font-semibold mb-2">Set Preferences</h3>
                <p className="text-gray-600 text-center max-w-xs">
                  Choose your level, preferred times, and notification settings
                </p>
              </div>

              <div className="hidden md:block text-gray-400">→</div>

              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-3">
                  <span className="text-xl">3</span>
                </div>
                <h3 className="font-semibold mb-2">Get Alerts</h3>
                <p className="text-gray-600 text-center max-w-xs">
                  Receive smart notifications for your perfect sessions
                </p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="bg-white rounded-xl p-8 text-center border">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Join the Bristol Surf Community</h2>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-2xl font-bold text-blue-600">🌊</div>
                <div className="text-sm text-gray-600">Smart Alerts</div>
              </div>
              
              <div>
                <div className="text-2xl font-bold text-blue-600">⚡</div>
                <div className="text-sm text-gray-600">Real-time Updates</div>
              </div>
              
              <div>
                <div className="text-2xl font-bold text-blue-600">🎯</div>
                <div className="text-sm text-gray-600">Precise Filtering</div>
              </div>
              
              <div>
                <div className="text-2xl font-bold text-blue-600">🏄</div>
                <div className="text-sm text-gray-600">Perfect Sessions</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}