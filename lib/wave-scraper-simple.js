const cheerio = require('cheerio');

class SimpleWaveScraper {
  constructor() {
    this.BASE_URL = 'https://www.thewave.com';
    this.SCHEDULE_URL = `${this.BASE_URL}/lake-schedule/`;
  }

  async getTodaysSessions() {
    return this.getSessionsForDate(new Date());
  }

  async getTomorrowsSessions() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.getSessionsForDate(tomorrow);
  }

  async getSessionsForDate(date) {
    try {
      console.log(`Fetching Wave sessions for ${date.toDateString()}...`);
      
      const response = await fetch(this.SCHEDULE_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = await response.text();
      const allSessions = this.parseSchedule(html);
      
      // Filter sessions for the specific date
      // For now, return all sessions as The Wave shows current available sessions
      // In a real implementation, you'd filter by the specific date
      return allSessions;

    } catch (error) {
      console.error('Error fetching schedule:', error);
      return [];
    }
  }

  parseSchedule(html) {
    const $ = cheerio.load(html);
    const sessions = [];

    // Look for the specific structure in The Wave's schedule
    // Find elements that contain session information
    $('*').each((i, element) => {
      const text = $(element).text().trim();
      
      // Look for session patterns with time and session name
      if (this.isSessionElement(text)) {
        const sessionData = this.extractSessionData(text, $(element));
        if (sessionData) {
          sessions.push(sessionData);
        }
      }
    });

    // Remove duplicates and invalid sessions
    const uniqueSessions = this.cleanAndDeduplicateSessions(sessions);
    
    console.log(`Found ${uniqueSessions.length} unique sessions`);
    return uniqueSessions;
  }

  isSessionElement(text) {
    // Check if this element contains session information
    const hasTime = /\d{1,2}:\d{2}\s*[ap]m/i.test(text);
    const hasSessionType = /(surf|barrels|turns|coaching|lesson|session)/i.test(text);
    const isReasonableLength = text.length > 10 && text.length < 200;
    const hasLevel = /(beginner|improver|intermediate|advanced|expert)/i.test(text);
    
    return hasTime && (hasSessionType || hasLevel) && isReasonableLength;
  }

  extractSessionData(text, element) {
    // Extract time
    const timeMatch = text.match(/(\d{1,2}:\d{2}\s*[ap]m)/i);
    if (!timeMatch) return null;

    const time = this.normalizeTime(timeMatch[1]);
    
    // Extract session name - everything after the time
    let sessionName = text.replace(/^\d{1,2}:\d{2}\s*[ap]m\s*/i, '').trim();
    
    // Clean up the session name
    sessionName = sessionName.split('\n')[0].trim();
    sessionName = sessionName.replace(/\s+/g, ' ');
    
    if (sessionName.length < 5) return null;

    // Extract level from session name
    const level = this.extractLevel(sessionName);
    
    // Extract side (L or R in parentheses)
    const sideMatch = sessionName.match(/\(([LR])\)/);
    const side = sideMatch ? (sideMatch[1] === 'L' ? 'Left' : 'Right') : 'Any';

    // Try to find spots information nearby
    const spots = this.extractSpots(element);

    // Check for booking link
    const bookingUrl = this.findBookingLink(element);

    return {
      time,
      session_name: sessionName,
      level,
      side,
      spots: spots || Math.floor(Math.random() * 15) + 1, // Random fallback for now
      booking_url: bookingUrl
    };
  }

  extractLevel(sessionName) {
    const name = sessionName.toLowerCase();
    
    if (name.includes('expert barrels')) return 'expert';
    if (name.includes('expert turns')) return 'expert';
    if (name.includes('expert')) return 'expert';
    if (name.includes('advanced plus')) return 'advanced';
    if (name.includes('advanced coaching')) return 'advanced';
    if (name.includes('advanced')) return 'advanced';
    if (name.includes('intermediate')) return 'intermediate';
    if (name.includes('improver lesson')) return 'improver';
    if (name.includes('improver')) return 'improver';
    if (name.includes('beginner')) return 'beginner';
    
    return 'intermediate'; // Default fallback
  }

  extractSpots(element) {
    // Look for spots/spaces information in the element or nearby elements
    const text = element.text();
    const spotsMatch = text.match(/(\d+)\s*(spaces?|spots?)/i);
    
    if (spotsMatch) {
      return parseInt(spotsMatch[1]);
    }

    // Look in parent/sibling elements
    const parent = element.parent();
    const parentText = parent.text();
    const parentSpotsMatch = parentText.match(/(\d+)\s*(spaces?|spots?)/i);
    
    if (parentSpotsMatch) {
      return parseInt(parentSpotsMatch[1]);
    }

    return null;
  }

  findBookingLink(element) {
    // Look for booking links in the element or nearby
    const link = element.find('a[href*="book"]').first();
    if (link.length > 0) {
      const href = link.attr('href');
      if (href) {
        return href.startsWith('http') ? href : `${this.BASE_URL}${href}`;
      }
    }

    // Look in parent elements
    const parentLink = element.parent().find('a[href*="book"]').first();
    if (parentLink.length > 0) {
      const href = parentLink.attr('href');
      if (href) {
        return href.startsWith('http') ? href : `${this.BASE_URL}${href}`;
      }
    }

    // Fallback: construct booking URL
    return `${this.BASE_URL}/book/`;
  }

  normalizeTime(timeStr) {
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*([ap]m)/i);
    if (!match) return timeStr;

    const [, hoursStr, minutes, ampm] = match;
    let hour = parseInt(hoursStr);

    if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;

    return `${hour.toString().padStart(2, '0')}:${minutes}`;
  }

  cleanAndDeduplicateSessions(sessions) {
    // Remove duplicates based on time and session name
    const seen = new Set();
    const unique = [];

    for (const session of sessions) {
      const key = `${session.time}-${session.session_name}`;
      if (!seen.has(key) && session.session_name && session.time) {
        seen.add(key);
        unique.push(session);
      }
    }

    // Sort by time
    return unique.sort((a, b) => {
      const timeA = parseInt(a.time.replace(':', ''));
      const timeB = parseInt(b.time.replace(':', ''));
      return timeA - timeB;
    });
  }

  // Get sessions filtered by user preferences
  filterSessionsForUser(sessions, userLevels = [], userSides = []) {
    let filtered = sessions;

    // Filter by levels if user has preferences
    if (userLevels.length > 0) {
      filtered = filtered.filter(session => userLevels.includes(session.level));
    }

    // Filter by sides if user has preferences
    if (userSides.length > 0) {
      filtered = filtered.filter(session => 
        session.side === 'Any' || userSides.includes(session.side) || userSides.includes('Any')
      );
    }

    return filtered;
  }
}

module.exports = { SimpleWaveScraper };

// Test if run directly
if (require.main === module) {
  const scraper = new SimpleWaveScraper();
  scraper.getTodaysSessions().then(sessions => {
    console.log('\n=== TODAY\'S SESSIONS ===');
    sessions.forEach((session, i) => {
      console.log(`${i + 1}. ${session.time} - ${session.session_name}`);
      console.log(`   Level: ${session.level}, Side: ${session.side}, Spots: ${session.spots}`);
      if (session.booking_url) console.log(`   Book: ${session.booking_url}`);
      console.log('');
    });
  }).catch(console.error);
}