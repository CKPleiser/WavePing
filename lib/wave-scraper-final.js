const axios = require('axios');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const advancedFormat = require('dayjs/plugin/advancedFormat');
const isoWeek = require('dayjs/plugin/isoWeek');
const isBetween = require('dayjs/plugin/isBetween');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);
dayjs.extend(isoWeek);
dayjs.extend(isBetween);

class WaveScheduleScraper {
  constructor(opts = {}) {
    this.BASE_URL = 'https://www.thewave.com';
    this.SCHEDULE_URL = `${this.BASE_URL}/lake-schedule/`;
    this.TIMEZONE = 'Europe/London';
    this.http = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': WaveScheduleScraper._ua(),
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      },
      validateStatus: s => s >= 200 && s < 500
    });
    this.maxRetries = opts.maxRetries || 4;
  }

  // Public API
  async getSessionsForDate(date) {
    const target = dayjs(date).tz(this.TIMEZONE).startOf('day');
    const weekMonday = this._weekMonday(target);
    const html = await this._fetchWeek(weekMonday);
    const sessions = this._parseSchedule(html, weekMonday);

    const label = target.format('ddd Do MMM');
    const forDay = sessions.filter(s => s.dateLabel === label && s.dateISO === target.format('YYYY-MM-DD'));

    if (forDay.length === 0) {
      const availableLabels = [...new Set(sessions.map(s => s.dateLabel))].join(', ');
      throw new Error(`No sessions found for ${label} (week of ${weekMonday.format('YYYY-MM-DD')}). Available day labels on page: ${availableLabels || 'none'}`);
    }
    return forDay;
  }

  async getTodaysSessions() {
    return this.getSessionsForDate(dayjs().tz(this.TIMEZONE));
  }

  async getTomorrowsSessions() {
    return this.getSessionsForDate(dayjs().tz(this.TIMEZONE).add(1, 'day'));
  }

  /**
   * Fetch sessions from today (inclusive) to today + N days (default 14).
   * Returns a flat, chronologically sorted list.
   */
  async getSessionsInRange(days = 14, startDate = dayjs().tz(this.TIMEZONE)) {
    const start = dayjs(startDate).tz(this.TIMEZONE).startOf('day');
    const end = start.add(days, 'day').endOf('day');

    // Determine unique Mondays we must fetch
    const weeks = new Set();
    let cursor = start.startOf('day');
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      weeks.add(this._weekMonday(cursor).format('YYYY-MM-DD'));
      cursor = cursor.add(1, 'day');
    }

    const pages = await Promise.all(
      [...weeks].map(async d => {
        const monday = dayjs.tz(d, this.TIMEZONE);
        const html = await this._fetchWeek(monday);
        return this._parseSchedule(html, monday);
      })
    );

    const all = pages.flat()
      .filter(s => dayjs.tz(`${s.dateISO} ${s.time24}`, this.TIMEZONE).isBetween(start, end, null, '[]'));

    // Dedupe + sort
    const byKey = new Map();
    for (const s of all) {
      const key = `${s.dateISO}|${s.time24}|${s.session_name}`;
      if (!byKey.has(key)) byKey.set(key, s);
    }
    return [...byKey.values()].sort((a, b) =>
      (a.dateISO + a.time24).localeCompare(b.dateISO + b.time24)
    );
  }

  // ---------- internals ----------

  async _fetchWeek(monday) {
    const url = `${this.SCHEDULE_URL}?date=${monday.format('YYYY-MM-DD')}`;
    return this._fetchWithRetries(url);
  }

  async _fetchWithRetries(url) {
    let lastErr;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const res = await this.http.get(url);
        if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        if (!res.data || String(res.data).length < 1000) throw new Error(`Minimal content (${res.data?.length || 0})`);
        return res.data;
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, 400 * (i + 1) ** 2)); // 0.4s, 1.6s, 3.6s, 6.4s
      }
    }
    throw new Error(`Failed to fetch ${url}: ${lastErr?.message || 'unknown error'}`);
  }

  _parseSchedule(html, weekMonday) {
    const $ = cheerio.load(html);

    // Quick sanity: ensure we're on a schedule page for the requested week
    const header = $(':contains("Session Calendar")').length > 0;
    if (!header) return [];

    // The page is fairly text-heavy; extract a clean line stream
    const text = $('body').text();
    const lines = text.split('\n')
      .map(x => x.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const dayHeaderRe = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}(st|nd|rd|th)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
    const dayNameRe = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i;
    const dayDateRe = /^\d{1,2}(st|nd|rd|th)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
    const timeRe = /^(\d{1,2}:\d{2}\s*[ap]m)$/i;

    let currentDayLabel = null;
    const sessions = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Find day headers - check for combined format first
      if (dayHeaderRe.test(line)) {
        currentDayLabel = line;
        continue;
      }
      
      // Handle split day format: "Thu" on one line, "11th Sep" on next
      if (dayNameRe.test(line) && i + 1 < lines.length && dayDateRe.test(lines[i + 1])) {
        currentDayLabel = `${line} ${lines[i + 1]}`;
        i++; // Skip the date line since we consumed it
        continue;
      }

      if (!currentDayLabel) continue;

      // Timeslots
      if (timeRe.test(line)) {
        const timeLabel = line;
        let j = i + 1;
        while (j < lines.length && !timeRe.test(lines[j]) && !dayHeaderRe.test(lines[j])) {
          const name = lines[j];
          const next = lines[j + 1] || '';

          // Cases:
          //   <Name> / <n spaces | Fully Booked>
          //   <Name with 'n spaces'> on same line (rare)
          if (/(Fully Booked|\d+\s+spaces?)/i.test(next)) {
            const s = this._buildSession(weekMonday, currentDayLabel, timeLabel, name, next);
            if (s) sessions.push(s);
            j += 2;
          } else if (/(Fully Booked|\d+\s+spaces?)/i.test(name)) {
            const availMatch = name.match(/(Fully Booked|\d+\s+spaces?)/i)?.[1];
            const cleanName = name.replace(/\s+(Fully Booked|\d+\s+spaces?).*$/i, '');
            const s = this._buildSession(weekMonday, currentDayLabel, timeLabel, cleanName, availMatch || '');
            if (s) sessions.push(s);
            j += 1;
          } else {
            j += 1;
          }
        }
        i = j - 1;
      }
    }

    // Dedup & sort within this week
    const map = new Map();
    for (const s of sessions) {
      const key = `${s.dateISO}|${s.time24}|${s.session_name}`;
      if (!map.has(key)) map.set(key, s);
    }
    return [...map.values()].sort((a, b) => (a.dateISO + a.time24).localeCompare(b.dateISO + b.time24));
  }

  _buildSession(weekMonday, dayLabel, timeLabel, nameLine, availabilityLine) {
    try {
      const dateISO = this._dateFromLabel(dayLabel, weekMonday).format('YYYY-MM-DD');
      const time24 = this._to24(timeLabel);
      const sessionName = nameLine.replace(/\s+/g, ' ').trim();
      if (!sessionName || sessionName.length < 3) return null;

      const side = /\((L|R)\)/i.test(sessionName)
        ? (sessionName.match(/\((L|R)\)/i)[1].toUpperCase() === 'L' ? 'Left' : 'Right')
        : 'Any';

      let spots = 0;
      if (/Fully Booked/i.test(availabilityLine)) {
        spots = 0;
      } else {
        const sm = availabilityLine.match(/(\d+)\s+spaces?/i);
        spots = sm ? parseInt(sm[1], 10) : 0;
      }

      const level = this._extractLevel(sessionName);

      return {
        dateLabel: dayLabel,
        dateISO,
        time: time24,
        time24,
        session_name: sessionName,
        level,
        side,
        spots,
        spots_available: spots,
        is_full: spots === 0,
        booking_url: 'https://ticketing.thewave.com/'
      };
    } catch {
      return null;
    }
  }

  // Compute Monday for any date (site's "Week Beginning" is Monday)
  _weekMonday(d) {
    const dt = dayjs(d).tz(this.TIMEZONE);
    // isoWeekday: Mon=1 … Sun=7
    const diff = dt.isoWeekday() - 1;
    return dt.subtract(diff, 'day').startOf('day');
  }

  // Use the requested week's year as ground truth to avoid Dec/Jan ambiguity
  _dateFromLabel(label, weekMonday) {
    const m = label.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})(?:st|nd|rd|th)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i);
    if (!m) throw new Error(`Invalid date label: ${label}`);
    const day = parseInt(m[2], 10);
    const monthIndex = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[3].toLowerCase());
    const year = weekMonday.year(); // lock to week's year
    return dayjs.tz(`${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, this.TIMEZONE);
  }

  _to24(s) {
    const m = s.match(/(\d{1,2}):(\d{2})\s*([ap]m)/i);
    if (!m) return s;
    let h = parseInt(m[1], 10);
    const min = m[2];
    const ap = m[3].toLowerCase();
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2,'0')}:${min}`;
  }

  _extractLevel(name) {
    const n = name.toLowerCase();
    if (n.includes('expert barrels') || n.includes('expert turns')) return 'expert';
    if (n.includes('expert')) return 'expert';
    if (n.includes('advanced plus')) return 'advanced';
    if (n.includes('advanced')) return 'advanced';
    if (n.includes('intermediate')) return 'intermediate';
    if (n.includes('improver')) return 'improver';
    if (n.includes('beginner') || n.includes('play in the bay') || n.includes('little rippers')) return 'beginner';
    return 'intermediate';
  }

  static _ua() {
    const pool = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Legacy compatibility methods
  filterSessionsForUser(sessions, userLevels = [], userSides = [], userDays = [], skipDayFilter = false) {
    let filtered = sessions;

    // Filter by levels if user has preferences
    if (userLevels.length > 0) {
      filtered = filtered.filter(session => userLevels.includes(session.level));
    }

    // Filter by sides if user has preferences
    if (userSides.length > 0) {
      filtered = filtered.filter(session => {
        // If user selected "Any", show all sessions
        if (userSides.includes('Any')) return true;
        
        // Session sides are 'Left'/'Right'/'Any' from scraper, user sides are 'Left'/'Right'/'Any' from server formatting
        // Direct comparison should work
        return userSides.includes(session.side);
      });
    }

    // Filter by days - skip this for today/tomorrow commands
    if (userDays.length > 0 && !skipDayFilter) {
      // This is for notifications - filter based on session date's day of week
      const now = dayjs().tz(this.TIMEZONE);
      const sessionDay = (now.day() + 6) % 7; // Convert Sunday=0 to Monday=0 format
      
      if (!userDays.includes(sessionDay)) {
        filtered = [];
      }
    }

    return filtered;
  }
}

module.exports = { WaveScheduleScraper };

// Test if run directly
if (require.main === module) {
  (async () => {
    const scraper = new WaveScheduleScraper();
    try {
      const list = await scraper.getSessionsInRange(14);
      console.log(`Found ${list.length} sessions in next 14 days`);
      for (const s of list.slice(0, 20)) {
        console.log(`${s.dateISO} ${s.time24} | ${s.session_name} | ${s.level} | ${s.side} | spots:${s.spots}`);
      }
    } catch (e) {
      console.error('SCRAPER FAILED:', e.message);
    }
  })();
}