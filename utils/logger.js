/**
 * Simple logger utility with different log levels
 */
class Logger {
  constructor(context = 'App') {
    this.context = context
    this.levels = {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      DEBUG: 3
    }
    this.currentLevel = process.env.LOG_LEVEL ? 
      this.levels[process.env.LOG_LEVEL.toUpperCase()] || 2 : 2
  }

  formatMessage(level, message, data) {
    const timestamp = new Date().toISOString()
    const emoji = this.getEmoji(level)
    const prefix = `[${timestamp}] ${emoji} [${this.context}]`
    
    if (data) {
      return `${prefix} ${message} ${JSON.stringify(data, null, 2)}`
    }
    return `${prefix} ${message}`
  }

  getEmoji(level) {
    const emojis = {
      ERROR: '❌',
      WARN: '⚠️',
      INFO: '📱',
      DEBUG: '🔍'
    }
    return emojis[level] || '📝'
  }

  error(message, data) {
    if (this.currentLevel >= this.levels.ERROR) {
      console.error(this.formatMessage('ERROR', message, data))
    }
  }

  warn(message, data) {
    if (this.currentLevel >= this.levels.WARN) {
      console.warn(this.formatMessage('WARN', message, data))
    }
  }

  info(message, data) {
    if (this.currentLevel >= this.levels.INFO) {
      console.log(this.formatMessage('INFO', message, data))
    }
  }

  debug(message, data) {
    if (this.currentLevel >= this.levels.DEBUG) {
      console.log(this.formatMessage('DEBUG', message, data))
    }
  }

  // Create a child logger with a new context
  child(context) {
    return new Logger(`${this.context}:${context}`)
  }
}

// Create singleton instance
const logger = new Logger()

module.exports = logger