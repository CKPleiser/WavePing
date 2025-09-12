#!/usr/bin/env node

/**
 * Environment Validation Script
 * Validates all required environment variables and configurations
 */

require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const axios = require('axios')

// Terminal colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
}

class EnvironmentValidator {
  constructor() {
    this.errors = []
    this.warnings = []
    this.successes = []
  }

  log(message, type = 'info') {
    const prefix = {
      error: `${colors.red}❌`,
      warning: `${colors.yellow}⚠️`,
      success: `${colors.green}✅`,
      info: `${colors.cyan}ℹ️`,
      header: `${colors.bright}${colors.blue}📋`
    }[type] || ''

    console.log(`${prefix} ${message}${colors.reset}`)

    if (type === 'error') this.errors.push(message)
    if (type === 'warning') this.warnings.push(message)
    if (type === 'success') this.successes.push(message)
  }

  header(title) {
    console.log(`\n${colors.bright}${colors.blue}═══════════════════════════════════════${colors.reset}`)
    console.log(`${colors.bright}${colors.blue}  ${title}${colors.reset}`)
    console.log(`${colors.bright}${colors.blue}═══════════════════════════════════════${colors.reset}\n`)
  }

  /**
   * Validate required environment variables
   */
  validateEnvironmentVariables() {
    this.header('Environment Variables')

    const required = {
      // Telegram
      TELEGRAM_BOT_TOKEN: {
        description: 'Telegram Bot API Token',
        pattern: /^\d+:[A-Za-z0-9_-]+$/,
        sensitive: true
      },
      
      // Supabase
      NEXT_PUBLIC_SUPABASE_URL: {
        description: 'Supabase Project URL',
        pattern: /^https:\/\/[a-z0-9]+\.supabase\.co$/
      },
      NEXT_PUBLIC_SUPABASE_ANON_KEY: {
        description: 'Supabase Anonymous Key',
        pattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
        sensitive: true
      },
      SUPABASE_SERVICE_KEY: {
        description: 'Supabase Service Role Key',
        pattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
        sensitive: true
      },
      
      // Security
      CRON_SECRET: {
        description: 'Cron Job Authentication Secret',
        minLength: 32,
        sensitive: true
      }
    }

    const optional = {
      PORT: {
        description: 'Server Port',
        default: '3000',
        pattern: /^\d+$/
      },
      NODE_ENV: {
        description: 'Node Environment',
        default: 'development',
        values: ['development', 'production', 'test']
      },
      LOG_LEVEL: {
        description: 'Logging Level',
        default: 'INFO',
        values: ['ERROR', 'WARN', 'INFO', 'DEBUG']
      },
      TELEGRAM_WEBHOOK_URL: {
        description: 'Telegram Webhook URL',
        pattern: /^https:\/\/.+$/
      }
    }

    // Check required variables
    for (const [key, config] of Object.entries(required)) {
      const value = process.env[key]
      
      if (!value) {
        this.log(`Missing required: ${key} - ${config.description}`, 'error')
        continue
      }

      if (config.pattern && !config.pattern.test(value)) {
        this.log(`Invalid format: ${key} - ${config.description}`, 'error')
        continue
      }

      if (config.minLength && value.length < config.minLength) {
        this.log(`Too short: ${key} - Must be at least ${config.minLength} characters`, 'error')
        continue
      }

      const displayValue = config.sensitive ? 
        `${value.substring(0, 6)}...${value.substring(value.length - 4)}` : 
        value
      this.log(`${key}: ${displayValue}`, 'success')
    }

    // Check optional variables
    for (const [key, config] of Object.entries(optional)) {
      const value = process.env[key] || config.default
      
      if (config.pattern && value && !config.pattern.test(value)) {
        this.log(`Invalid format: ${key} - ${config.description}`, 'warning')
        continue
      }

      if (config.values && !config.values.includes(value)) {
        this.log(`Invalid value: ${key} = ${value} (should be one of: ${config.values.join(', ')})`, 'warning')
        continue
      }

      if (process.env[key]) {
        this.log(`${key}: ${value}`, 'success')
      } else {
        this.log(`${key}: Using default (${config.default})`, 'info')
      }
    }
  }

  /**
   * Test database connection
   */
  async testDatabaseConnection() {
    this.header('Database Connection')

    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
      )

      // Test connection with a simple query
      const { data, error } = await supabase
        .from('profiles')
        .select('count')
        .limit(1)

      if (error) {
        this.log(`Database connection failed: ${error.message}`, 'error')
        return
      }

      this.log('Database connection successful', 'success')

      // Check table existence
      const tables = ['profiles', 'sessions', 'user_levels', 'user_notifications']
      for (const table of tables) {
        const { error: tableError } = await supabase
          .from(table)
          .select('count')
          .limit(1)

        if (tableError) {
          this.log(`Table '${table}' check failed: ${tableError.message}`, 'error')
        } else {
          this.log(`Table '${table}' exists`, 'success')
        }
      }

    } catch (error) {
      this.log(`Database test failed: ${error.message}`, 'error')
    }
  }

  /**
   * Test Telegram bot connection
   */
  async testTelegramBot() {
    this.header('Telegram Bot')

    if (!process.env.TELEGRAM_BOT_TOKEN) {
      this.log('Skipping Telegram test - token not configured', 'warning')
      return
    }

    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`
      )

      if (response.data.ok) {
        const bot = response.data.result
        this.log(`Bot connected: @${bot.username} (${bot.first_name})`, 'success')
        this.log(`Bot ID: ${bot.id}`, 'info')
        this.log(`Can join groups: ${bot.can_join_groups}`, 'info')
        this.log(`Can read messages: ${bot.can_read_all_group_messages}`, 'info')
      } else {
        this.log('Telegram bot verification failed', 'error')
      }

      // Check webhook status
      const webhookResponse = await axios.get(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`
      )

      if (webhookResponse.data.ok) {
        const webhook = webhookResponse.data.result
        if (webhook.url) {
          this.log(`Webhook configured: ${webhook.url}`, 'success')
          if (webhook.last_error_message) {
            this.log(`Last webhook error: ${webhook.last_error_message}`, 'warning')
          }
        } else {
          this.log('No webhook configured (using polling)', 'info')
        }
      }

    } catch (error) {
      this.log(`Telegram bot test failed: ${error.message}`, 'error')
    }
  }

  /**
   * Check file system and permissions
   */
  checkFileSystem() {
    this.header('File System')

    const requiredDirs = [
      'middleware',
      'services',
      'utils',
      'config',
      'tests',
      'lib',
      'scripts',
      'types'
    ]

    const requiredFiles = [
      'server.js',
      'package.json',
      '.env.local'
    ]

    // Check directories
    for (const dir of requiredDirs) {
      const dirPath = path.join(process.cwd(), dir)
      if (fs.existsSync(dirPath)) {
        this.log(`Directory '${dir}' exists`, 'success')
      } else {
        this.log(`Directory '${dir}' missing`, 'warning')
      }
    }

    // Check files
    for (const file of requiredFiles) {
      const filePath = path.join(process.cwd(), file)
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath)
        this.log(`File '${file}' exists (${stats.size} bytes)`, 'success')
      } else {
        this.log(`File '${file}' missing`, file === '.env.local' ? 'error' : 'warning')
      }
    }

    // Check write permissions
    try {
      const testFile = path.join(process.cwd(), '.write-test')
      fs.writeFileSync(testFile, 'test')
      fs.unlinkSync(testFile)
      this.log('Write permissions OK', 'success')
    } catch (error) {
      this.log('No write permissions in current directory', 'error')
    }
  }

  /**
   * Check Node.js version and dependencies
   */
  checkNodeEnvironment() {
    this.header('Node.js Environment')

    // Check Node version
    const nodeVersion = process.version
    const requiredVersion = '20.0.0'
    const currentMajor = parseInt(nodeVersion.split('.')[0].substring(1))
    const requiredMajor = parseInt(requiredVersion.split('.')[0])

    if (currentMajor >= requiredMajor) {
      this.log(`Node.js version: ${nodeVersion}`, 'success')
    } else {
      this.log(`Node.js version ${nodeVersion} is below required ${requiredVersion}`, 'error')
    }

    // Check package.json exists
    const packagePath = path.join(process.cwd(), 'package.json')
    if (fs.existsSync(packagePath)) {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
      
      // Check critical dependencies
      const criticalDeps = ['express', 'telegraf', '@supabase/supabase-js', 'dotenv']
      for (const dep of criticalDeps) {
        if (packageJson.dependencies && packageJson.dependencies[dep]) {
          this.log(`Dependency '${dep}' found: ${packageJson.dependencies[dep]}`, 'success')
        } else {
          this.log(`Missing critical dependency: ${dep}`, 'error')
        }
      }
    } else {
      this.log('package.json not found', 'error')
    }

    // Check if node_modules exists
    const nodeModulesPath = path.join(process.cwd(), 'node_modules')
    if (fs.existsSync(nodeModulesPath)) {
      const moduleCount = fs.readdirSync(nodeModulesPath).length
      this.log(`node_modules exists with ${moduleCount} packages`, 'success')
    } else {
      this.log('node_modules not found - run npm install', 'error')
    }
  }

  /**
   * Generate summary report
   */
  generateSummary() {
    this.header('Validation Summary')

    const total = this.successes.length + this.warnings.length + this.errors.length

    console.log(`${colors.green}✅ Successes: ${this.successes.length}${colors.reset}`)
    console.log(`${colors.yellow}⚠️  Warnings: ${this.warnings.length}${colors.reset}`)
    console.log(`${colors.red}❌ Errors: ${this.errors.length}${colors.reset}`)
    console.log(`${colors.cyan}📊 Total checks: ${total}${colors.reset}`)

    if (this.errors.length === 0) {
      console.log(`\n${colors.bright}${colors.green}🎉 Environment validation passed!${colors.reset}`)
      console.log(`${colors.green}Your WavePing application is ready to run.${colors.reset}`)
      return 0
    } else {
      console.log(`\n${colors.bright}${colors.red}⚠️  Environment validation failed!${colors.reset}`)
      console.log(`${colors.red}Please fix the ${this.errors.length} error(s) before running the application.${colors.reset}`)
      
      console.log(`\n${colors.yellow}Errors to fix:${colors.reset}`)
      this.errors.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error}`)
      })
      
      return 1
    }
  }

  /**
   * Run all validations
   */
  async runAll() {
    console.log(`${colors.bright}${colors.cyan}🔍 WavePing Environment Validator${colors.reset}`)
    console.log(`${colors.cyan}   Version 1.1.0${colors.reset}`)
    
    this.validateEnvironmentVariables()
    this.checkNodeEnvironment()
    this.checkFileSystem()
    await this.testDatabaseConnection()
    await this.testTelegramBot()
    
    const exitCode = this.generateSummary()
    
    if (exitCode === 0) {
      console.log(`\n${colors.cyan}💡 Next steps:${colors.reset}`)
      console.log('  1. Run: npm run dev (for development)')
      console.log('  2. Run: npm start (for production)')
      console.log('  3. Run: npm test (to run tests)')
    }
    
    process.exit(exitCode)
  }
}

// Run validator
const validator = new EnvironmentValidator()
validator.runAll().catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`)
  process.exit(1)
})