#!/usr/bin/env node

// Apply the function fix
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const SUPABASE_PAT = process.argv[2] || process.env.SUPABASE_PAT || 'sbp_35b2e3c1d698b536a8c88c613731e9103fb7f721';

async function applyFix() {
  try {
    // Get project info
    const projectsResponse = await fetch('https://api.supabase.com/v1/projects', {
      headers: {
        'Authorization': `Bearer ${SUPABASE_PAT}`,
        'Content-Type': 'application/json'
      }
    });

    const projects = await projectsResponse.json();
    const project = projects.find(p => p.name && p.name.toLowerCase().includes('waveping'));
    
    // Read fix SQL
    const fixSQL = fs.readFileSync(path.join(__dirname, 'fix-function.sql'), 'utf8');
    
    console.log('🔧 Applying function fix...');
    
    const response = await fetch(`https://api.supabase.com/v1/projects/${project.id}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: fixSQL
      })
    });

    if (response.ok) {
      console.log('✅ Function fix applied successfully!');
    } else {
      const error = await response.text();
      console.log('⚠️  Fix failed (function might already be working):', error);
    }

  } catch (error) {
    console.log('⚠️  Could not apply fix:', error.message);
  }
}

applyFix();