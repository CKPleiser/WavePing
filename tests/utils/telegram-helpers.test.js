const {
  toHTML,
  toMarkdown,
  checkRateLimit,
  createSetupSession,
  isSetupExpired
} = require('../../utils/telegram-helpers')

describe('Telegram Helpers', () => {
  describe('toHTML', () => {
    test('should escape HTML special characters', () => {
      expect(toHTML('<script>alert("XSS")</script>')).toBe('&lt;script&gt;alert("XSS")&lt;/script&gt;')
      expect(toHTML('Hello & Goodbye')).toBe('Hello &amp; Goodbye')
      expect(toHTML('5 > 3 && 2 < 4')).toBe('5 &gt; 3 &amp;&amp; 2 &lt; 4')
    })

    test('should handle null and undefined', () => {
      expect(toHTML(null)).toBe('')
      expect(toHTML(undefined)).toBe('')
      expect(toHTML('')).toBe('')
    })

    test('should convert non-strings to strings', () => {
      expect(toHTML(123)).toBe('123')
      expect(toHTML(true)).toBe('true')
    })
  })

  describe('toMarkdown', () => {
    test('should escape Markdown special characters', () => {
      expect(toMarkdown('*bold* text')).toBe('\\*bold\\* text')
      expect(toMarkdown('_italic_ text')).toBe('\\_italic\\_ text')
      expect(toMarkdown('[link](url)')).toBe('\\[link\\]\\(url\\)')
      expect(toMarkdown('`code`')).toBe('\\`code\\`')
    })

    test('should handle null and undefined', () => {
      expect(toMarkdown(null)).toBe('')
      expect(toMarkdown(undefined)).toBe('')
      expect(toMarkdown('')).toBe('')
    })
  })

  describe('checkRateLimit', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    test('should allow first request', () => {
      expect(checkRateLimit('user1')).toBe(true)
    })

    test('should block rapid requests', () => {
      checkRateLimit('user2')
      expect(checkRateLimit('user2')).toBe(false)
    })

    test('should allow request after rate limit expires', () => {
      checkRateLimit('user3')
      jest.advanceTimersByTime(3001)
      expect(checkRateLimit('user3')).toBe(true)
    })

    test('should track different keys separately', () => {
      expect(checkRateLimit('user4')).toBe(true)
      expect(checkRateLimit('user5')).toBe(true)
      expect(checkRateLimit('user4')).toBe(false)
      expect(checkRateLimit('user5')).toBe(false)
    })

    test('should respect custom rate limit', () => {
      checkRateLimit('user6', 1000)
      jest.advanceTimersByTime(999)
      expect(checkRateLimit('user6', 1000)).toBe(false)
      jest.advanceTimersByTime(2)
      expect(checkRateLimit('user6', 1000)).toBe(true)
    })
  })

  describe('createSetupSession', () => {
    test('should create session with default values', () => {
      const session = createSetupSession()
      
      expect(session.levels).toEqual([])
      expect(session.sides).toEqual([])
      expect(session.days).toEqual([])
      expect(session.timeWindows).toEqual([])
      expect(session.notifications).toEqual(['24h'])
      expect(session.minSpots).toBe(1)
      expect(session.step).toBe('levels')
      expect(session.createdAt).toBeDefined()
    })

    test('should allow overriding default values', () => {
      const session = createSetupSession({
        levels: ['beginner'],
        minSpots: 3,
        step: 'sides'
      })
      
      expect(session.levels).toEqual(['beginner'])
      expect(session.minSpots).toBe(3)
      expect(session.step).toBe('sides')
      expect(session.notifications).toEqual(['24h'])
    })
  })

  describe('isSetupExpired', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2024-01-01 12:00:00'))
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    test('should return true for null or undefined setup', () => {
      expect(isSetupExpired(null)).toBe(true)
      expect(isSetupExpired(undefined)).toBe(true)
      expect(isSetupExpired({})).toBe(true)
    })

    test('should return false for fresh session', () => {
      const setup = { createdAt: Date.now() }
      expect(isSetupExpired(setup)).toBe(false)
    })

    test('should return true for expired session (default 15 minutes)', () => {
      const setup = { createdAt: Date.now() }
      jest.advanceTimersByTime(15 * 60 * 1000 + 1)
      expect(isSetupExpired(setup)).toBe(true)
    })

    test('should respect custom TTL', () => {
      const setup = { createdAt: Date.now() }
      jest.advanceTimersByTime(5 * 60 * 1000)
      
      expect(isSetupExpired(setup, 10)).toBe(false)
      expect(isSetupExpired(setup, 5)).toBe(false)
      expect(isSetupExpired(setup, 4)).toBe(true)
    })
  })
})