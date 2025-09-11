import { createClient } from '@supabase/supabase-js'
import { WaveScraper } from '../../../lib/scraper/wave-scraper'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  // Verify cron secret
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('🕷️ Starting scheduled scrape...')
    
    const scraper = new WaveScraper(supabase)
    const results = await scraper.scrapeSchedule()
    
    console.log(`✅ Scrape completed: ${results.sessionsFound} sessions found, ${results.sessionsSaved} saved`)
    
    // Log scrape results
    await supabase.from('scrape_logs').insert({
      success: results.success,
      sessions_found: results.sessionsFound,
      sessions_saved: results.sessionsSaved,
      error: results.error,
      created_at: new Date().toISOString()
    })
    
    return res.status(200).json({
      success: true,
      sessionsFound: results.sessionsFound,
      sessionsSaved: results.sessionsSaved
    })
    
  } catch (error) {
    console.error('Scrape error:', error)
    
    await supabase.from('scrape_logs').insert({
      success: false,
      error: error.message,
      created_at: new Date().toISOString()
    })
    
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    })
  }
}