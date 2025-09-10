import * as cheerio from 'cheerio'
import crypto from 'crypto'
import { format, addDays } from 'date-fns'
import type { SessionLevel, SessionRow } from '../supabase/types'

export interface ScrapedSession {
  id: string
  date: string
  start_time: string
  end_time: string | null
  session_name: string
  level: SessionLevel | null
  side: string | null
  total_spots: number | null
  spots_available: number | null
  book_url: string | null
  instructor: string | null
}

export class WaveScraper {
  private readonly BASE_URL = 'https://www.thewave.com'
  private readonly SCHEDULE_URL = `${this.BASE_URL}/lake-schedule/`

  // Level mapping patterns
  private readonly LEVEL_PATTERNS: Record<string, SessionLevel> = {
    'beginner': 'beginner',
    'improver surf': 'improver',
    'improver session': 'improver',
    'intermediate surf': 'intermediate',
    'intermediate session': 'intermediate',
    'advanced plus surf': 'advanced_plus',
    'advanced surf': 'advanced',
    'expert turns surf': 'expert_turns',
    'expert barrels surf': 'expert_barrels',
    'expert surf': 'expert',
    'women-only': 'women_only',
    'women only': 'women_only',
    'improver lesson': 'improver_lesson',
    'intermediate surf lesson': 'intermediate_lesson',
    'intermediate lesson': 'intermediate_lesson',
    'advanced coaching': 'advanced_coaching',
    'high performance coaching': 'high_performance_coaching'
  }

  // Side extraction pattern
  private readonly SIDE_PATTERN = /\(([LR])\)/i

  async scrapeSchedule(days: number = 7): Promise<ScrapedSession[]> {
    try {
      console.log(`Scraping Wave schedule for ${days} days...`)
      
      const response = await fetch(this.SCHEDULE_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const html = await response.text()
      const sessions = this.parseScheduleHTML(html)
      
      console.log(`Scraped ${sessions.length} sessions`)
      return sessions

    } catch (error) {
      console.error('Error scraping schedule:', error)
      throw error
    }
  }

  private parseScheduleHTML(html: string): ScrapedSession[] {
    const $ = cheerio.load(html)
    const sessions: ScrapedSession[] = []

    // The Wave might use different selectors - these are common patterns
    const sessionSelectors = [
      '.session-item',
      '.booking-item', 
      '.timetable-item',
      '[data-session]',
      '.schedule-row'
    ]

    let sessionElements: cheerio.Cheerio<any> | null = null
    
    for (const selector of sessionSelectors) {
      const elements = $(selector)
      if (elements.length > 0) {
        sessionElements = elements
        console.log(`Found ${elements.length} sessions using selector: ${selector}`)
        break
      }
    }

    // Fallback: look for any elements with time patterns
    if (!sessionElements || sessionElements.length === 0) {
      console.log('No sessions found with standard selectors, trying fallback approach...')
      sessionElements = $('*').filter((_, el) => {
        const text = $(el).text()
        return /\d{1,2}:\d{2}/.test(text) && text.length < 200
      })
    }

    if (!sessionElements || sessionElements.length === 0) {
      console.warn('No session elements found in HTML')
      return sessions
    }

    sessionElements.each((_, element) => {
      try {
        const sessionData = this.parseSessionElement($, $(element))
        if (sessionData) {
          sessions.push(sessionData)
        }
      } catch (error) {
        console.error('Error parsing session element:', error)
      }
    })

    // Remove duplicates based on ID
    const uniqueSessions = sessions.filter((session, index, self) => 
      index === self.findIndex(s => s.id === session.id)
    )

    return uniqueSessions
  }

  private parseSessionElement($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>): ScrapedSession | null {
    const text = element.text().trim()
    const html = element.html() || ''

    // Extract date - look for date patterns
    const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{4}-\d{2}-\d{2})/)
    let date = new Date().toISOString().split('T')[0] // Default to today
    
    if (dateMatch) {
      const dateStr = dateMatch[0]
      const parsedDate = new Date(dateStr)
      if (!isNaN(parsedDate.getTime())) {
        date = parsedDate.toISOString().split('T')[0]
      }
    }

    // Extract time - look for time patterns
    const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/g)
    if (!timeMatch || timeMatch.length === 0) {
      return null // No time found, skip this element
    }

    const startTime = this.normalizeTime(timeMatch[0])
    const endTime = timeMatch.length > 1 ? this.normalizeTime(timeMatch[1]) : null

    // Extract session name - usually the main text content
    let sessionName = text.replace(/\d{1,2}:\d{2}[^\s]*/g, '').trim()
    sessionName = sessionName.replace(/\d+\s*(spaces?|spots?).*$/i, '').trim()
    
    if (!sessionName) {
      sessionName = text.split('\n')[0].trim()
    }

    // Extract level from session name
    const level = this.extractLevel(sessionName)

    // Extract side from session name
    const side = this.extractSide(sessionName)

    // Extract spots available
    const spotsMatch = text.match(/(\d+)\s*(spaces?|spots?)/i)
    const spotsAvailable = spotsMatch ? parseInt(spotsMatch[1]) : null

    // Look for booking URL
    const bookLink = element.find('a[href*="book"]').first()
    let bookUrl: string | null = null
    
    if (bookLink.length) {
      const href = bookLink.attr('href')
      if (href) {
        bookUrl = href.startsWith('http') ? href : `${this.BASE_URL}${href}`
      }
    }

    // Extract instructor if mentioned
    const instructorMatch = text.match(/(?:with|instructor:?)\s*([A-Za-z\s]+)/i)
    const instructor = instructorMatch ? instructorMatch[1].trim() : null

    // Generate unique ID
    const sessionId = this.generateSessionId(date, startTime, sessionName)

    // Check if this looks like a valid session
    if (!sessionName || sessionName.length < 3) {
      return null
    }

    return {
      id: sessionId,
      date,
      start_time: startTime,
      end_time: endTime,
      session_name: sessionName,
      level,
      side,
      total_spots: spotsAvailable, // Assume available spots is total for now
      spots_available: spotsAvailable,
      book_url: bookUrl,
      instructor
    }
  }

  private normalizeTime(timeStr: string): string {
    // Convert various time formats to HH:MM
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/)
    if (!match) return timeStr

    const [, hoursStr, minutes, ampm] = match
    let hour = parseInt(hoursStr)

    if (ampm) {
      const isAM = ampm.toLowerCase() === 'am'
      if (!isAM && hour !== 12) hour += 12
      if (isAM && hour === 12) hour = 0
    }

    return `${hour.toString().padStart(2, '0')}:${minutes}`
  }

  private extractLevel(sessionName: string): SessionLevel | null {
    const nameLower = sessionName.toLowerCase()
    
    // Try exact matches first
    for (const [pattern, level] of Object.entries(this.LEVEL_PATTERNS)) {
      if (nameLower.includes(pattern.toLowerCase())) {
        return level
      }
    }

    // Fallback patterns
    if (nameLower.includes('lesson')) return 'improver_lesson'
    if (nameLower.includes('coaching')) return 'advanced_coaching'
    if (nameLower.includes('women')) return 'women_only'
    if (nameLower.includes('expert')) return 'expert'
    if (nameLower.includes('advanced')) return 'advanced'
    if (nameLower.includes('intermediate')) return 'intermediate'
    if (nameLower.includes('improver')) return 'improver'
    if (nameLower.includes('beginner')) return 'beginner'

    return null
  }

  private extractSide(sessionName: string): string | null {
    const match = sessionName.match(this.SIDE_PATTERN)
    return match ? match[1].toUpperCase() : null
  }

  private generateSessionId(date: string, time: string, name: string): string {
    const combined = `${date}-${time}-${name}`
    return crypto.createHash('md5').update(combined).digest('hex').substring(0, 12)
  }

  // Helper method for testing
  async testScraping(): Promise<void> {
    try {
      console.log('Testing Wave scraper...')
      const sessions = await this.scrapeSchedule(1)
      
      console.log(`\nFound ${sessions.length} sessions:`)
      sessions.slice(0, 5).forEach((session, i) => {
        console.log(`\n${i + 1}. ${session.session_name}`)
        console.log(`   Date: ${session.date}`)
        console.log(`   Time: ${session.start_time}${session.end_time ? '-' + session.end_time : ''}`)
        console.log(`   Level: ${session.level || 'Unknown'}`)
        console.log(`   Side: ${session.side || 'Any'}`)
        console.log(`   Spots: ${session.spots_available || 'Unknown'}`)
        console.log(`   Book URL: ${session.book_url || 'None'}`)
      })

      if (sessions.length > 5) {
        console.log(`\n... and ${sessions.length - 5} more sessions`)
      }

    } catch (error) {
      console.error('Scraping test failed:', error)
    }
  }
}

// For testing purposes
if (process.env.NODE_ENV === 'development' && require.main === module) {
  const scraper = new WaveScraper()
  scraper.testScraping()
}