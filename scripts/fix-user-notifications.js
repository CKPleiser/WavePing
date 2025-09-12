#!/usr/bin/env node
/**
 * Fix User Notifications Data
 * Converts old notification timing format to new digest system
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function fixUserNotifications() {
  console.log('🔧 Starting notification data migration...')
  
  try {
    // Get all users with old notification format
    const { data: users, error: fetchError } = await supabase
      .from('profiles')
      .select(`
        id,
        telegram_id,
        user_notifications (timing)
      `)
    
    if (fetchError) {
      throw fetchError
    }
    
    console.log(`📊 Found ${users.length} users to check`)
    
    let updatedCount = 0
    
    for (const user of users) {
      const notifications = user.user_notifications || []
      
      // Check if user has old format notifications
      const hasOldFormat = notifications.some(n => 
        ['1w', '48h', '24h', '12h', '2h', '6h', '3h', '1h'].includes(n.timing)
      )
      
      if (hasOldFormat) {
        console.log(`🔄 Updating user ${user.telegram_id}...`)
        
        // Clear existing notifications
        const { error: deleteError } = await supabase
          .from('user_notifications')
          .delete()
          .eq('user_id', user.id)
        
        if (deleteError) {
          console.error(`❌ Error clearing notifications for user ${user.telegram_id}:`, deleteError)
          continue
        }
        
        // Try to add morning digest, but handle enum error
        let { error: insertError } = await supabase
          .from('user_notifications')
          .insert({
            user_id: user.id,
            timing: 'morning'
          })
        
        // If morning doesn't work, try the old 24h format which should map to morning
        if (insertError && insertError.code === '22P02') {
          console.log('  📝 Trying with 24h format...')
          const { error: insertError2 } = await supabase
            .from('user_notifications')
            .insert({
              user_id: user.id,
              timing: '24h'
            })
          
          if (insertError2) {
            console.error(`❌ Error adding 24h notification for user ${user.telegram_id}:`, insertError2)
            continue
          }
        } else if (insertError) {
          console.error(`❌ Error adding morning digest for user ${user.telegram_id}:`, insertError)
          continue
        }
        
        if (insertError) {
          console.error(`❌ Error adding morning digest for user ${user.telegram_id}:`, insertError)
          continue
        }
        
        updatedCount++
        console.log(`✅ Updated user ${user.telegram_id} to morning digest`)
      }
    }
    
    console.log(`\n🎉 Migration complete!`)
    console.log(`📊 Updated ${updatedCount} users`)
    
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  }
}

// Run the migration
fixUserNotifications()
  .then(() => {
    console.log('✅ All done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Script failed:', error)
    process.exit(1)
  })