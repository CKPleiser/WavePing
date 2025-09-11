const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')

dayjs.extend(utc)
dayjs.extend(timezone)

const TZ = 'Europe/London'

exports.today = () => dayjs().tz(TZ).format('YYYY-MM-DD')
exports.tomorrow = () => dayjs().tz(TZ).add(1, 'day').format('YYYY-MM-DD')
exports.formatTime = (time24) => {
  const [hours, minutes] = time24.split(':')
  const hour = parseInt(hours)
  const period = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour
  return `${hour12}:${minutes} ${period}`
}