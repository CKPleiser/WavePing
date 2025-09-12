/**
 * Jest test setup
 */

// Mock environment variables for tests
process.env.NODE_ENV = 'test'
process.env.TELEGRAM_BOT_TOKEN = 'test-token'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'test-service-key'
process.env.CRON_SECRET = 'test-cron-secret'

// Global test utilities
global.testUtils = {
  mockTelegramContext: () => ({
    reply: jest.fn().mockResolvedValue(true),
    editMessageText: jest.fn().mockResolvedValue(true),
    chat: { id: 12345 },
    from: { id: 12345, username: 'testuser' }
  }),
  
  mockSupabaseClient: () => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis()
  })
}

// Console suppression for cleaner test output
const originalConsoleError = console.error
const originalConsoleLog = console.log
const originalConsoleWarn = console.warn

beforeEach(() => {
  // Suppress console output in tests unless VERBOSE=true
  if (!process.env.VERBOSE) {
    console.error = jest.fn()
    console.log = jest.fn()
    console.warn = jest.fn()
  }
})

afterEach(() => {
  // Restore console methods
  if (!process.env.VERBOSE) {
    console.error = originalConsoleError
    console.log = originalConsoleLog
    console.warn = originalConsoleWarn
  }
  
  // Clear all mocks
  jest.clearAllMocks()
})