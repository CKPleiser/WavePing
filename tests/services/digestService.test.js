const DigestService = require('../../services/digestService')

describe('DigestService', () => {
  let digestService
  let mockSupabase
  let mockBot
  let mockScraper

  beforeEach(() => {
    // Mock Supabase client
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis()
    }

    // Mock Telegram bot
    mockBot = {
      telegram: {
        sendMessage: jest.fn().mockResolvedValue(true)
      }
    }

    // Create service instance
    digestService = new DigestService(mockSupabase, mockBot)

    // Mock scraper methods
    digestService.scraper.getTodaysSessions = jest.fn().mockResolvedValue([])
    digestService.scraper.getTomorrowsSessions = jest.fn().mockResolvedValue([])
    digestService.scraper.getSessionsInRange = jest.fn().mockResolvedValue([])
    digestService.scraper.filterSessionsForUser = jest.fn().mockReturnValue([])
  })

  describe('getDigestUsers', () => {
    test('should fetch users with specific digest type', async () => {
      const mockProfiles = [
        { 
          id: '1', 
          telegram_id: 123, 
          user_notifications: [{ timing: '24h' }]
        }
      ]
      const mockDigestUsers = [{ user_id: '1' }]

      mockSupabase.eq.mockResolvedValueOnce({ 
        data: mockProfiles, 
        error: null 
      })
      mockSupabase.eq.mockResolvedValueOnce({ 
        data: mockDigestUsers, 
        error: null 
      })

      const users = await digestService.getDigestUsers('morning')

      expect(users).toHaveLength(1)
      expect(users[0].telegram_id).toBe(123)
      expect(mockSupabase.from).toHaveBeenCalledWith('profiles')
      expect(mockSupabase.from).toHaveBeenCalledWith('user_digest_preferences')
    })

    test('should filter out users without notification preferences', async () => {
      const mockProfiles = [
        { id: '1', telegram_id: 123, user_notifications: [] },
        { id: '2', telegram_id: 456, user_notifications: [{ timing: '24h' }] }
      ]
      const mockDigestUsers = [
        { user_id: '1' },
        { user_id: '2' }
      ]

      mockSupabase.eq.mockResolvedValueOnce({ 
        data: mockProfiles, 
        error: null 
      })
      mockSupabase.eq.mockResolvedValueOnce({ 
        data: mockDigestUsers, 
        error: null 
      })

      const users = await digestService.getDigestUsers('morning')

      expect(users).toHaveLength(1)
      expect(users[0].telegram_id).toBe(456)
    })

    test('should throw error on database error', async () => {
      mockSupabase.eq.mockResolvedValueOnce({ 
        data: null, 
        error: new Error('Database error') 
      })

      await expect(digestService.getDigestUsers('morning')).rejects.toThrow('Database error')
    })
  })

  describe('filterSessionsForUser', () => {
    test('should filter sessions based on user preferences', () => {
      const sessions = [
        { spots_available: 5, level: 'beginner' },
        { spots_available: 2, level: 'intermediate' },
        { spots_available: 0, level: 'beginner' }
      ]
      const user = {
        min_spots: 3,
        user_levels: [{ level: 'beginner' }],
        user_sides: [{ side: 'L' }],
        user_days: [],
        user_time_windows: []
      }

      digestService.scraper.filterSessionsForUser.mockReturnValue([
        { spots_available: 5, level: 'beginner' },
        { spots_available: 0, level: 'beginner' }
      ])

      const filtered = digestService.filterSessionsForUser(sessions, user)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].spots_available).toBe(5)
    })
  })

  describe('formatSession', () => {
    test('should format session without date', () => {
      const session = {
        time: '10:00',
        session_name: 'Morning Wave',
        spots_available: 3,
        booking_url: 'https://example.com/book'
      }

      const formatted = digestService.formatSession(session)

      expect(formatted).toContain('*10:00*')
      expect(formatted).toContain('Morning Wave')
      expect(formatted).toContain('3 spots available')
      expect(formatted).toContain('[Book Now]')
    })

    test('should format session with date', () => {
      const session = {
        dateLabel: 'Tomorrow',
        time: '14:00',
        session_name: 'Afternoon Session',
        spots_available: 1,
        booking_url: 'https://example.com/book'
      }

      const formatted = digestService.formatSession(session, true)

      expect(formatted).toContain('*Tomorrow*')
      expect(formatted).toContain('*14:00*')
      expect(formatted).toContain('1 spot available')
    })

    test('should use default booking URL when not provided', () => {
      const session = {
        time: '10:00',
        session_name: 'Test Session',
        spots_available: 2
      }

      const formatted = digestService.formatSession(session)

      expect(formatted).toContain('https://thewave.com/bristol/book/')
    })
  })

  describe('sendMorningDigest', () => {
    test('should send morning digest to eligible users', async () => {
      const mockUser = {
        id: '1',
        telegram_id: 123,
        min_spots: 1,
        user_levels: [{ level: 'beginner' }],
        user_notifications: [{ timing: '24h' }]
      }

      const mockSessions = [
        { 
          time: '10:00', 
          session_name: 'Morning Wave',
          spots_available: 3,
          booking_url: 'https://example.com'
        }
      ]

      mockSupabase.eq.mockResolvedValueOnce({ 
        data: [mockUser], 
        error: null 
      })
      mockSupabase.eq.mockResolvedValueOnce({ 
        data: [{ user_id: '1' }], 
        error: null 
      })

      digestService.scraper.getTodaysSessions.mockResolvedValue(mockSessions)
      digestService.scraper.filterSessionsForUser.mockReturnValue(mockSessions)

      const result = await digestService.sendMorningDigest()

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].status).toBe('sent')
      expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining('Good Morning'),
        expect.objectContaining({ parse_mode: 'Markdown' })
      )
    })

    test('should skip users with no matching sessions', async () => {
      const mockUser = {
        id: '1',
        telegram_id: 123,
        min_spots: 10,
        user_levels: [{ level: 'pro' }],
        user_notifications: [{ timing: '24h' }]
      }

      mockSupabase.eq.mockResolvedValueOnce({ 
        data: [mockUser], 
        error: null 
      })
      mockSupabase.eq.mockResolvedValueOnce({ 
        data: [{ user_id: '1' }], 
        error: null 
      })

      digestService.scraper.filterSessionsForUser.mockReturnValue([])

      const result = await digestService.sendMorningDigest()

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(0)
      expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled()
    })

    test('should handle send failures gracefully', async () => {
      const mockUser = {
        id: '1',
        telegram_id: 123,
        min_spots: 1,
        user_notifications: [{ timing: '24h' }]
      }

      mockSupabase.eq.mockResolvedValueOnce({ 
        data: [mockUser], 
        error: null 
      })
      mockSupabase.eq.mockResolvedValueOnce({ 
        data: [{ user_id: '1' }], 
        error: null 
      })

      digestService.scraper.filterSessionsForUser.mockReturnValue([
        { spots_available: 3 }
      ])

      mockBot.telegram.sendMessage.mockRejectedValue(new Error('Network error'))

      const result = await digestService.sendMorningDigest()

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].status).toBe('failed')
      expect(result.results[0].error).toBe('Network error')
    })
  })

  describe('sendEveningDigest', () => {
    test('should send evening digest with tomorrow and upcoming sessions', async () => {
      const mockUser = {
        id: '1',
        telegram_id: 456,
        min_spots: 1,
        user_notifications: [{ timing: '12h' }]
      }

      const tomorrowSessions = [
        { 
          time: '09:00', 
          session_name: 'Early Wave',
          spots_available: 5,
          dateISO: '2024-01-02'
        }
      ]

      const upcomingSessions = [
        ...tomorrowSessions,
        { 
          time: '11:00', 
          session_name: 'Weekend Wave',
          spots_available: 8,
          dateISO: '2024-01-03',
          dateLabel: 'Saturday'
        }
      ]

      mockSupabase.eq.mockResolvedValueOnce({ 
        data: [mockUser], 
        error: null 
      })
      mockSupabase.eq.mockResolvedValueOnce({ 
        data: [{ user_id: '1' }], 
        error: null 
      })

      digestService.scraper.getTomorrowsSessions.mockResolvedValue(tomorrowSessions)
      digestService.scraper.getSessionsInRange.mockResolvedValue(upcomingSessions)
      digestService.scraper.filterSessionsForUser
        .mockReturnValueOnce(tomorrowSessions)
        .mockReturnValueOnce(upcomingSessions)

      const result = await digestService.sendEveningDigest()

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].status).toBe('sent')
      expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
        456,
        expect.stringContaining('Evening Wave Report'),
        expect.objectContaining({ parse_mode: 'Markdown' })
      )
    })
  })

  describe('getQuickCommands', () => {
    test('should return morning quick commands', () => {
      const commands = digestService.getQuickCommands()
      
      expect(commands).toContain('/today')
      expect(commands).toContain('/tomorrow')
      expect(commands).toContain('/prefs')
      expect(commands).toContain('Ready to catch some waves')
    })
  })

  describe('getEveningCommands', () => {
    test('should return evening quick commands', () => {
      const commands = digestService.getEveningCommands()
      
      expect(commands).toContain('/tomorrow')
      expect(commands).toContain('/prefs')
      expect(commands).toContain('/notify')
      expect(commands).toContain('Rest well')
    })
  })
})