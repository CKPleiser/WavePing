#!/usr/bin/env node

// Simple migration runner that executes the SQL file as a single transaction
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const SUPABASE_PAT = process.argv[2] || process.env.SUPABASE_PAT || 'sbp_35b2e3c1d698b536a8c88c613731e9103fb7f721';

console.log('🌊 Running WavePing database migration...');

async function runMigration() {
  try {
    // Get project info
    const projectsResponse = await fetch('https://api.supabase.com/v1/projects', {
      headers: {
        'Authorization': `Bearer ${SUPABASE_PAT}`,
        'Content-Type': 'application/json'
      }
    });

    if (!projectsResponse.ok) {
      throw new Error(`Failed to list projects: ${projectsResponse.status}`);
    }

    const projects = await projectsResponse.json();
    const project = projects.find(p => p.name && p.name.toLowerCase().includes('waveping')) || projects[0];
    
    if (!project) {
      throw new Error('No projects found');
    }

    console.log(`🎯 Running migration on project: ${project.name}`);

    // Read migration file
    const migrationPath = path.join(__dirname, '../supabase/migrations/20240908000001_initial_schema.sql');
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log(`📄 Loaded migration file (${Math.round(migrationSQL.length / 1024)}KB)`);

    // Execute migration as single query
    console.log('🚀 Executing migration...');
    
    const response = await fetch(`https://api.supabase.com/v1/projects/${project.id}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: migrationSQL
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Migration failed:', errorText);
      return false;
    }

    const result = await response.json();
    console.log('✅ Migration executed successfully!');
    
    // Update .env.local with project info
    await updateEnvFile(project);
    
    console.log('\n🚀 WavePing database migration complete!');
    console.log('Next steps:');
    console.log('1. Set up your Telegram bot token in .env.local');
    console.log('2. Test locally with: npm run dev');
    console.log('3. Deploy to Vercel');

    return true;

  } catch (error) {
    console.error('💥 Migration failed:', error.message);
    return false;
  }
}

async function updateEnvFile(project) {
  console.log('📝 Updating .env.local file...');
  
  try {
    // Get API keys
    const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${project.id}/api-keys`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_PAT}`,
        'Content-Type': 'application/json'
      }
    });

    if (!keysResponse.ok) {
      console.log('⚠️  Could not retrieve API keys, please add them manually');
      return;
    }

    const keys = await keysResponse.json();
    const anonKey = keys.find(k => k.name?.includes('anon'))?.api_key;
    const serviceKey = keys.find(k => k.name?.includes('service'))?.api_key;

    const envPath = path.join(__dirname, '../.env.local');
    let envContent = '';
    
    // Load existing .env.local if it exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    const projectUrl = `https://${project.id}.supabase.co`;
    
    // Update or add Supabase variables
    const updates = {
      'NEXT_PUBLIC_SUPABASE_URL': projectUrl,
      'NEXT_PUBLIC_SUPABASE_ANON_KEY': anonKey || 'YOUR_ANON_KEY',
      'SUPABASE_SERVICE_KEY': serviceKey || 'YOUR_SERVICE_KEY'
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
    console.log('⚠️  Could not update .env.local automatically');
    console.log(`Please manually add: NEXT_PUBLIC_SUPABASE_URL=https://${project.id}.supabase.co`);
  }
}

// Run the migration
if (require.main === module) {
  runMigration().then(success => {
    process.exit(success ? 0 : 1);
  });
}