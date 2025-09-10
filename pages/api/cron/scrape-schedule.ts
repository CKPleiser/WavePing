import type { VercelRequest, VercelResponse } from '@vercel/node'
import { WaveScraper, type ScrapedSession } from '../../../lib/scraper/wave-scraper'
import { createAdminClient } from '../../../lib/supabase/client'
import type { SessionRow } from '../../../lib/supabase/types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('Starting scheduled scrape...')
    
    const scraper = new WaveScraper()
    const supabase = createAdminClient()
    
    // Scrape new sessions
    const scrapedSessions = await scraper.scrapeSchedule(7)
    
    if (scrapedSessions.length === 0) {
      console.log('No sessions found during scrape')
      return res.status(200).json({ 
        message: 'No sessions found', 
        processed: 0 
      })
    }

    // Get existing sessions for comparison
    const { data: existingSessions } = await supabase
      .from('sessions')
      .select('*')
      .eq('is_active', true)

    const existingById = new Map(
      (existingSessions || []).map((session: any) => [session.id, session])
    )

    let newSessions = 0
    let updatedSessions = 0
    const changes: any[] = []

    // Process each scraped session
    for (const session of scrapedSessions) {
      const existing: any = existingById.get(session.id)
      
      if (!existing) {
        // New session
        const { error } = await supabase
          .from('sessions')
          .insert({
            ...session,
            first_seen: new Date().toISOString(),
            last_updated: new Date().toISOString(),
            is_active: true
          })

        if (error) {
          console.error('Error inserting session:', error)
        } else {
          newSessions++
          changes.push({
            type: 'new',
            session_id: session.id,
            session_name: session.session_name
          })
        }
      } else if ((existing.spots_available || 0) !== (session.spots_available || 0)) {
        // Update existing session with new spot count
        const { error } = await supabase
          .from('sessions')
          .update({
            spots_available: session.spots_available,
            last_updated: new Date().toISOString()
          })
          .eq('id', session.id)

        if (error) {
          console.error('Error updating session:', error)
        } else {
          updatedSessions++
          
          const oldSpots = existing.spots_available || 0
          const newSpots = session.spots_available || 0
          
          // Log the change
          await supabase.from('session_changes').insert({
            session_id: session.id,
            change_type: newSpots > oldSpots 
              ? 'spots_increased' 
              : 'spots_decreased',
            old_spots: oldSpots,
            new_spots: newSpots,
            detected_at: new Date().toISOString()
          })

          changes.push({
            type: newSpots > oldSpots 
              ? 'spots_increased' 
              : 'spots_decreased',
            session_id: session.id,
            session_name: session.session_name,
            old_spots: oldSpots,
            new_spots: newSpots
          })

          // Trigger notifications for significant changes
          if (newSpots > 0 && oldSpots === 0) {
            // Spots just became available
            await triggerSpotAvailableNotifications(session)
          } else if (newSpots <= 3 && oldSpots > 3) {
            // Session is filling up
            await triggerFillingFastNotifications(session)
          }
        }
      }
    }

    // Mark sessions as inactive if they weren't found in the scrape
    // (only for sessions in the past or that have become unavailable)
    const scrapedIds = new Set(scrapedSessions.map((s: any) => s.id))
    const toDeactivate = (existingSessions || []).filter(
      (session: any) => !scrapedIds.has(session.id) && new Date(session.date) >= new Date()
    )

    if (toDeactivate.length > 0) {
      await supabase
        .from('sessions')
        .update({ is_active: false })
        .in('id', toDeactivate.map((s: any) => s.id))
      
      console.log(`Deactivated ${toDeactivate.length} sessions`)
    }

    console.log(`Scrape complete: ${newSessions} new, ${updatedSessions} updated`)

    res.status(200).json({
      message: 'Schedule updated successfully',
      new_sessions: newSessions,
      updated_sessions: updatedSessions,
      total_scraped: scrapedSessions.length,
      changes: changes.slice(0, 10) // Limit response size
    })

  } catch (error) {
    console.error('Schedule scraping error:', error)
    res.status(500).json({ 
      error: 'Failed to scrape schedule',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function triggerSpotAvailableNotifications(session: ScrapedSession) {
  // TODO: Implement immediate "spots available" notifications
  console.log(`🎉 Spots available for ${session.session_name}`)
}

async function triggerFillingFastNotifications(session: ScrapedSession) {
  // TODO: Implement "filling fast" notifications
  console.log(`⚠️ ${session.session_name} filling fast - ${session.spots_available} spots left`)
}