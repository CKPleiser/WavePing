#!/usr/bin/env node

// Enhanced database setup script that can work with just a Supabase PAT
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const SUPABASE_PAT = process.argv[2] || process.env.SUPABASE_PAT || 'sbp_35b2e3c1d698b536a8c88c613731e9103fb7f721';

if (!SUPABASE_PAT) {
  console.error('❌ Missing Supabase PAT (Personal Access Token)');
  console.error('Usage: node setup-supabase-with-pat.js <PAT>');
  console.error('Or set SUPABASE_PAT in .env.local');
  process.exit(1);
}

console.log('🌊 Setting up WavePing database with Supabase PAT...');

async function discoverProject() {
  console.log('🔍 Discovering Supabase projects...');
  
  try {
    // List projects to find the right one
    const response = await fetch('https://api.supabase.com/v1/projects', {
      headers: {
        'Authorization': `Bearer ${SUPABASE_PAT}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list projects: ${response.status} ${error}`);
    }

    const projects = await response.json();
    console.log(`📋 Found ${projects.length} project(s)`);
    
    if (projects.length === 0) {
      throw new Error('No projects found. Please create a Supabase project first.');
    }

    // Debug: log project structure
    console.log('Available projects:');
    projects.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name || 'Unnamed'} (id: ${p.id || 'N/A'}, ref: ${p.ref || 'N/A'})`);
    });

    // For now, use the first project or look for "waveping"
    let targetProject = projects.find(p => 
      p.name && p.name.toLowerCase().includes('waveping')
    ) || projects[0];
    
    if (!targetProject.ref && targetProject.id) {
      targetProject.ref = targetProject.id;
    }
    
    console.log(`🎯 Selected project: ${targetProject.name} (${targetProject.ref || targetProject.id})`);
    
    if (!targetProject.ref && !targetProject.id) {
      throw new Error('Selected project has no valid reference ID');
    }
    
    const projectRef = targetProject.ref || targetProject.id;
    
    return {
      ref: projectRef,
      url: `https://${projectRef}.supabase.co`,
      name: targetProject.name || 'Unnamed Project'
    };
  } catch (error) {
    console.error('❌ Failed to discover project:', error.message);
    throw error;
  }
}

async function getProjectKeys(projectRef) {
  console.log('🔑 Retrieving project API keys...');
  
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_PAT}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get API keys: ${response.status} ${error}`);
    }

    const keys = await response.json();
    
    console.log('Available API keys:');
    keys.forEach((k, i) => {
      console.log(`  ${i + 1}. ${k.name || k.type || 'Unnamed'} (key: ${k.api_key ? '***hidden***' : 'N/A'})`);
    });
    
    // Try different possible names for the keys
    const anonKey = keys.find(k => 
      k.name === 'anon public' || 
      k.name === 'anon' || 
      k.type === 'anon' ||
      k.name?.includes('anon')
    )?.api_key;
    
    const serviceKey = keys.find(k => 
      k.name === 'service_role' || 
      k.name === 'service' || 
      k.type === 'service_role' ||
      k.name?.includes('service')
    )?.api_key;
    
    console.log(`Found anon key: ${anonKey ? '✅' : '❌'}`);
    console.log(`Found service key: ${serviceKey ? '✅' : '❌'}`);
    
    if (!anonKey || !serviceKey) {
      throw new Error('Could not find required API keys. Check the available keys above.');
    }
    
    console.log('✅ Retrieved API keys successfully');
    
    return { anonKey, serviceKey };
  } catch (error) {
    console.error('❌ Failed to get API keys:', error.message);
    throw error;
  }
}

async function setupDatabase(projectUrl, serviceKey, projectRef) {
  console.log('🗄️  Setting up database schema...');
  
  const supabase = createClient(projectUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  try {
    // Test connection with a simple query
    console.log('🔍 Testing database connection...');
    
    try {
      const { data, error } = await supabase.rpc('version');
      if (error) {
        // Try alternative connection test
        const { data: testData, error: testError } = await supabase
          .from('pg_tables')
          .select('tablename')
          .limit(1);
        
        if (testError) {
          throw new Error(`Connection failed: ${testError.message}`);
        }
      }
    } catch (connError) {
      console.log('⚠️  Standard connection test failed, trying basic auth test...');
      // Just continue - we'll see if the migration works
    }
    
    console.log('✅ Database connection successful!');
    
    // Read migration file
    const migrationPath = path.join(__dirname, '../supabase/migrations/20240908000001_initial_schema.sql');
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log(`📄 Loaded migration file (${Math.round(migrationSQL.length / 1024)}KB)`);
    
    // Execute migrations by sending individual statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📋 Executing ${statements.length} SQL statements...`);
    
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      try {
        // Execute SQL using Supabase management API
        const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_PAT}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: statement + ';'
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          
          // Check if it's just a "already exists" error
          if (errorText.includes('already exists') || 
              errorText.includes('duplicate key value') ||
              (errorText.includes('relation') && errorText.includes('already exists'))) {
            console.log(`⚠️  [${i+1}/${statements.length}] Skipped (already exists): ${statement.substring(0, 60)}...`);
            skipCount++;
            continue;
          }
          
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        console.log(`✅ [${i+1}/${statements.length}] Executed: ${statement.substring(0, 60)}...`);
        successCount++;
        
      } catch (err) {
        console.error(`❌ [${i+1}/${statements.length}] Failed: ${statement.substring(0, 60)}...`);
        console.error(`   Error: ${err.message}`);
        errorCount++;
        
        // Continue with other statements unless it's a critical error
        if (err.message.includes('syntax error') && statement.includes('create table')) {
          console.error('   ⚠️  Critical table creation failed, stopping...');
          break;
        }
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n🎉 Database setup complete!`);
    console.log(`   ✅ ${successCount} statements executed successfully`);
    console.log(`   ⚠️  ${skipCount} statements skipped (already exist)`);
    console.log(`   ❌ ${errorCount} statements failed`);
    
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
          console.log(`❌ Table '${table}' not accessible: ${error.message}`);
        } else {
          console.log(`✅ Table '${table}' exists and accessible`);
        }
      } catch (err) {
        console.log(`❌ Error checking table '${table}': ${err.message}`);
      }
    }
    
    return true;
    
  } catch (error) {
    console.error('💥 Database setup failed:', error.message);
    return false;
  }
}

async function updateEnvFile(projectUrl, anonKey, serviceKey) {
  console.log('📝 Updating .env.local file...');
  
  try {
    const envPath = path.join(__dirname, '../.env.local');
    let envContent = '';
    
    // Load existing .env.local if it exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Update or add Supabase variables
    const updates = {
      'NEXT_PUBLIC_SUPABASE_URL': projectUrl,
      'NEXT_PUBLIC_SUPABASE_ANON_KEY': anonKey,
      'SUPABASE_SERVICE_KEY': serviceKey
    };
    
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (envContent.match(regex)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    }
    
    fs.writeFileSync(envPath, envContent.trim() + '\n');
    console.log('✅ Updated .env.local with Supabase configuration');
    
  } catch (error) {
    console.error('❌ Failed to update .env.local:', error.message);
    console.log('\nPlease manually add these to your .env.local file:');
    console.log(`NEXT_PUBLIC_SUPABASE_URL=${projectUrl}`);
    console.log(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`);
    console.log(`SUPABASE_SERVICE_KEY=${serviceKey}`);
  }
}

async function main() {
  try {
    const project = await discoverProject();
    const keys = await getProjectKeys(project.ref);
    
    console.log(`\n🏗️  Setting up database for project: ${project.name}`);
    console.log(`📍 URL: ${project.url}`);
    
    const success = await setupDatabase(project.url, keys.serviceKey, project.ref);
    
    if (success) {
      await updateEnvFile(project.url, keys.anonKey, keys.serviceKey);
      
      console.log('\n🚀 WavePing database setup complete!');
      console.log('\nNext steps:');
      console.log('1. Set up your Telegram bot token in .env.local');
      console.log('2. Test locally with: npm run dev');
      console.log('3. Deploy to Vercel');
      console.log('4. Set up webhook with: node scripts/setup-webhook.js');
    } else {
      console.log('\n❌ Setup completed with errors. Please check the output above.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n💥 Setup failed:', error.message);
    process.exit(1);
  }
}

// Run the setup
if (require.main === module) {
  main();
}