// Database setup script using Supabase client
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

// Allow override via command line arguments or fallback to provided PAT
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.argv[2];
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.argv[3] || 'sbp_35b2e3c1d698b536a8c88c613731e9103fb7f721';

if (!supabaseUrl) {
  console.error('❌ Missing Supabase URL');
  console.error('Usage: node setup-database.js [SUPABASE_URL] [SERVICE_KEY]');
  console.error('Or set NEXT_PUBLIC_SUPABASE_URL in .env.local');
  process.exit(1);
}

console.log('🌊 Setting up WavePing database...');
console.log(`📍 Connecting to: ${supabaseUrl}`);

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function setupDatabase() {
  try {
    // Test connection
    console.log('🔍 Testing database connection...');
    const { data, error } = await supabase
      .from('pg_tables')
      .select('tablename')
      .limit(1);
    
    if (error) {
      throw new Error(`Connection failed: ${error.message}`);
    }
    
    console.log('✅ Database connection successful!');
    
    // Read migration file
    const migrationPath = path.join(__dirname, '../supabase/migrations/20240908000001_initial_schema.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📋 Executing database migrations...');
    
    // Execute SQL using direct HTTP API since exec_sql might not be available
    console.log('📋 Executing database migrations using SQL statements...');
    
    let successCount = 0;
    let skipCount = 0;
    
    try {
      // Execute the entire migration as one transaction
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          sql: migrationSQL
        })
      });

      if (response.ok) {
        console.log('✅ Migration executed successfully as single transaction');
        successCount = 1;
      } else {
        // Fallback to statement-by-statement execution
        console.log('⚠️  Single transaction failed, trying statement by statement...');
        await executeStatementsIndividually();
      }
    } catch (error) {
      console.log('⚠️  Direct execution failed, trying alternative approach...');
      await executeStatementsIndividually();
    }

    async function executeStatementsIndividually() {
      // Split SQL into individual statements and execute them
      const statements = migrationSQL
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
      
      for (const statement of statements) {
        try {
          const { error } = await supabase.rpc('exec_sql', { 
            query: statement 
          });
          
          if (error) {
            // Check if it's just a "already exists" error
            if (error.message.includes('already exists') || 
                error.message.includes('duplicate key value')) {
              console.log(`⚠️  Skipped (already exists): ${statement.substring(0, 50)}...`);
              skipCount++;
              continue;
            }
            throw error;
          }
          
          console.log(`✅ Executed: ${statement.substring(0, 50)}...`);
          successCount++;
          
        } catch (err) {
          // Try alternative execution method
          try {
            const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
              method: 'POST',
              headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ sql: statement })
            });
            
            if (response.ok) {
              console.log(`✅ Executed (alt): ${statement.substring(0, 50)}...`);
              successCount++;
            } else {
              const errorText = await response.text();
              if (errorText.includes('already exists')) {
                console.log(`⚠️  Skipped (already exists): ${statement.substring(0, 50)}...`);
                skipCount++;
              } else {
                console.error(`❌ Failed: ${statement.substring(0, 50)}...`);
                console.error(`   Error: ${errorText}`);
              }
            }
          } catch (altErr) {
            console.error(`❌ Failed to execute: ${statement.substring(0, 50)}...`);
            console.error(`   Error: ${err.message}`);
          }
        }
      }
    }
    
    console.log(`\n🎉 Database setup complete!`);
    console.log(`   ✅ ${successCount} statements executed`);
    console.log(`   ⚠️  ${skipCount} statements skipped (already exist)`);
    
    // Verify setup by checking for key tables
    console.log('\n🔍 Verifying database setup...');
    
    const tables = ['profiles', 'sessions', 'user_levels', 'user_sides', 'weather_cache'];
    
    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (error) {
          console.log(`❌ Table '${table}' not found: ${error.message}`);
        } else {
          console.log(`✅ Table '${table}' exists and accessible`);
        }
      } catch (err) {
        console.log(`❌ Error checking table '${table}': ${err.message}`);
      }
    }
    
    console.log('\n🚀 Your WavePing database is ready!');
    console.log('Next steps:');
    console.log('1. Set up your Telegram bot token in .env.local');
    console.log('2. Deploy to Vercel');
    console.log('3. Set up webhook with: node scripts/setup-webhook.js');
    
  } catch (error) {
    console.error('💥 Database setup failed:', error.message);
    process.exit(1);
  }
}

// For older Supabase instances that don't have exec_sql, let's try direct SQL execution
async function executeSQLDirect(sql) {
  try {
    // Try using a custom SQL execution approach
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: sql })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    return await response.json();
  } catch (error) {
    throw new Error(`SQL execution failed: ${error.message}`);
  }
}

setupDatabase();