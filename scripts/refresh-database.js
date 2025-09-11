#!/usr/bin/env node

/**
 * Database refresh script for Railway deployment
 * Run this on Railway to clear stale data and fetch fresh sessions
 */

const { createClient } = require('@supabase/supabase-js');
const { WaveScheduleScraper } = require('../lib/wave-scraper-final.js');

async function refreshDatabase() {
  console.log('🔄 Starting database refresh...');
  
  // Initialize Supabase client
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 1. Clear existing sessions from today onwards
    console.log('🗑️  Clearing existing sessions...');
    const today = new Date().toISOString().split('T')[0];
    
    const { error: clearError } = await supabase
      .from('sessions')
      .delete()
      .gte('date', today);
    
    if (clearError) throw clearError;
    console.log('✅ Cleared sessions from', today);

    // 2. Fetch fresh sessions using improved scraper
    console.log('🌊 Scraping fresh sessions...');
    const scraper = new WaveScheduleScraper();
    const sessions = await scraper.getSessionsInRange(14);
    
    console.log(`📊 Found ${sessions.length} sessions for next 14 days`);

    // 3. Insert fresh sessions
    console.log('💾 Inserting fresh sessions...');
    const dbSessions = sessions.map(session => ({
      id: `${session.dateISO}_${session.time24}_${session.session_name}`.replace(/[^a-zA-Z0-9-_]/g, '_'),
      date: session.dateISO,
      start_time: session.time24,
      end_time: null,
      session_name: session.session_name,
      level: session.level,
      side: session.side === 'Left' ? 'L' : session.side === 'Right' ? 'R' : 'A',
      total_spots: session.spots,
      spots_available: session.spots_available,
      book_url: session.booking_url,
      instructor: null,
      is_active: true,
      last_updated: new Date().toISOString()
    }));

    const { error: insertError } = await supabase
      .from('sessions')
      .insert(dbSessions);
    
    if (insertError) throw insertError;

    // 4. Show sample of today's sessions for verification
    const todaySessions = dbSessions.filter(s => s.date === today);
    console.log(`✅ Successfully refreshed database!`);
    console.log(`📅 Today (${today}): ${todaySessions.length} sessions`);
    
    // Show first few sessions to verify data
    console.log('\n📋 Sample sessions for verification:');
    todaySessions.slice(0, 10).forEach(s => {
      const side = s.side === 'L' ? 'Left' : s.side === 'R' ? 'Right' : 'Any';
      console.log(`   ${s.start_time} | ${s.session_name} | ${s.level} | ${side} | ${s.spots_available} spots`);
    });

    console.log('\n🎉 Database refresh complete! Bot should now show correct data.');

  } catch (error) {
    console.error('❌ Database refresh failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  refreshDatabase();
}

module.exports = { refreshDatabase };