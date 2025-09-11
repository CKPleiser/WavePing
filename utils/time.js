const { DateTime } = require('luxon')

const TZ = 'Europe/London'

exports.today = () => DateTime.now().setZone(TZ).toISODate()
exports.tomorrow = () => DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate()
exports.formatTime = (time24) => {
  const dt = DateTime.fromFormat(time24, 'HH:mm', { zone: TZ })
  return dt.toFormat('h:mm a')
}