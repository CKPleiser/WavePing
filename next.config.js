/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
  },
  env: {
    CUSTOM_KEY: 'waveping-bot'
  }
}

module.exports = nextConfig