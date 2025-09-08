import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../lib/supabase/client'
import { format, addDays } from 'date-fns'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('Updating weather data...')
    
    const supabase = createAdminClient()
    const apiKey = process.env.OPENWEATHERMAP_API_KEY

    if (!apiKey) {
      throw new Error('OpenWeatherMap API key not configured')
    }

    // The Wave Bristol coordinates
    const lat = 51.4084
    const lon = -2.6397

    // Get weather for today and next 2 days
    const dates = [0, 1, 2].map(days => addDays(new Date(), days))
    
    for (const date of dates) {
      try {
        const dateStr = format(date, 'yyyy-MM-dd')
        
        // Check if we already have weather data for this date (within last 4 hours)
        const { data: existing } = await supabase
          .from('weather_cache')
          .select('*')
          .eq('date', dateStr)
          .gte('cached_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
          .single()

        if (existing) {
          console.log(`Weather data for ${dateStr} is still fresh, skipping`)
          continue
        }

        // Fetch current weather from OpenWeatherMap
        const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
        
        const weatherResponse = await fetch(weatherUrl)
        if (!weatherResponse.ok) {
          throw new Error(`Weather API error: ${weatherResponse.status}`)
        }

        const weatherData = await weatherResponse.json()
        
        // Extract relevant weather information
        const airTemp = Math.round(weatherData.main.temp * 10) / 10
        const windSpeed = Math.round(weatherData.wind.speed * 2.237) // m/s to mph
        const windDirection = getWindDirection(weatherData.wind.deg)
        const conditions = weatherData.weather[0].description
        const icon = weatherData.weather[0].icon

        // Estimate water temperature (simplified - could be enhanced)
        const waterTemp = estimateWaterTemperature(airTemp, date)

        // Upsert weather data
        const { error } = await supabase
          .from('weather_cache')
          .upsert({
            date: dateStr,
            air_temp: airTemp,
            water_temp: waterTemp,
            wind_speed: windSpeed,
            wind_direction: windDirection,
            conditions: conditions,
            icon: icon,
            cached_at: new Date().toISOString()
          }, {
            onConflict: 'date'
          })

        if (error) {
          console.error(`Error saving weather for ${dateStr}:`, error)
        } else {
          console.log(`Updated weather for ${dateStr}: ${airTemp}°C, ${conditions}`)
        }

        // Rate limiting - wait between API calls
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (error) {
        console.error(`Failed to update weather for ${format(date, 'yyyy-MM-dd')}:`, error)
      }
    }

    res.status(200).json({
      message: 'Weather data updated successfully',
      updated_dates: dates.map(d => format(d, 'yyyy-MM-dd'))
    })

  } catch (error) {
    console.error('Weather update error:', error)
    res.status(500).json({ 
      error: 'Failed to update weather data',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

function getWindDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(degrees / 22.5) % 16
  return directions[index]
}

function estimateWaterTemperature(airTemp: number, date: Date): number {
  // Simplified water temperature estimation
  // In reality, this would be more complex and could use historical data
  const month = date.getMonth() + 1
  
  // Bristol area seasonal water temperature adjustments
  const seasonalOffset = {
    1: -6,  // January
    2: -6,  // February  
    3: -4,  // March
    4: -2,  // April
    5: 0,   // May
    6: 2,   // June
    7: 4,   // July
    8: 4,   // August
    9: 2,   // September
    10: 0,  // October
    11: -3, // November
    12: -5  // December
  }[month] || -2

  // Base estimation: water temp = air temp + seasonal offset
  let waterTemp = airTemp + seasonalOffset
  
  // Clamp to reasonable range for UK inland waters
  waterTemp = Math.max(4, Math.min(22, waterTemp))
  
  return Math.round(waterTemp * 10) / 10
}