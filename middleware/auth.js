/**
 * Authentication middleware for cron endpoints
 */
function authenticateCron(req, res, next) {
  const authHeader = req.headers.authorization
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`
  
  if (authHeader !== expectedToken) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    })
  }
  
  next()
}

module.exports = {
  authenticateCron
}