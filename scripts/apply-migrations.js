#!/usr/bin/env node

/**
 * Apply database migrations on Railway
 * This ensures the unique index exists for proper UPSERT operations
 */

const { createClient } = require('@supabase/supabase-js');

async function applyMigrations() {
  console.log('🔧 Applying database migrations...');
  
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // Check if unique index exists
    console.log('🔍 Checking if unique index exists...');
    const { data: indexes, error: indexError } = await supabase.rpc('check_index_exists', {
      table_name: 'sessions',
      index_name: 'sessions_id_uidx'
    });

    if (indexError) {
      console.log('⚠️  Cannot check index (function might not exist), proceeding with creation...');
    }

    // Create unique index (will be ignored if exists)
    console.log('🏗️  Creating unique index on sessions.id...');
    const { error: createIndexError } = await supabase.rpc('exec_sql', {
      sql: 'create unique index if not exists sessions_id_uidx on sessions(id);'
    });

    if (createIndexError) {
      console.log('⚠️  Cannot create via RPC, using direct SQL...');
      
      // Fallback: Use direct SQL execution
      const { error: directError } = await supabase
        .from('sessions')
        .select('id', { count: 'exact', head: true });
      
      if (directError) {
        console.log('❌ Database connection failed:', directError.message);
        return;
      }
      
      console.log('✅ Database connected, but need to run SQL manually');
      console.log('\n📋 Run this SQL in your Supabase dashboard:');
      console.log('--------------------------------------------');
      console.log('-- Add unique index on sessions.id for UPSERT operations');
      console.log('create unique index if not exists sessions_id_uidx on sessions(id);');
      console.log('');
      console.log('-- Add index for efficient date range queries'); 
      console.log('create index if not exists idx_sessions_date_active on sessions(date, is_active);');
      console.log('--------------------------------------------');
    } else {
      console.log('✅ Unique index created successfully');
    }

    // Test UPSERT operation
    console.log('🧪 Testing UPSERT operation...');
    const testRow = {
      id: 'test_2025-09-11_15-00_Test_Session',
      date: '2025-09-11',
      start_time: '15:00',
      session_name: 'Test Session',
      level: 'intermediate',
      side: 'A',
      total_spots: 15,
      spots_available: 15,
      book_url: 'https://test.com',
      is_active: true,
      last_updated: new Date().toISOString()
    };

    const { error: upsertError } = await supabase
      .from('sessions')
      .upsert([testRow], { onConflict: 'id' });

    if (upsertError) {
      console.log('❌ UPSERT test failed:', upsertError.message);
      console.log('This indicates the unique index is not working properly');
    } else {
      console.log('✅ UPSERT test successful');
      
      // Clean up test record
      await supabase
        .from('sessions')
        .delete()
        .eq('id', testRow.id);
    }

    console.log('🎉 Migration check complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
  }
}

if (require.main === module) {
  applyMigrations();
}

module.exports = { applyMigrations };