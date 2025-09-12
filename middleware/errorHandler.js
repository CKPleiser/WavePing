/**
 * Global error handling middleware
 */
function errorHandler(err, req, res, next) {
  // Log error details for debugging
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  })
  
  // Determine status code
  const status = err.status || err.statusCode || 500
  
  // Send appropriate response
  res.status(status).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: status,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  })
}

/**
 * Async route handler wrapper to catch errors
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

module.exports = {
  errorHandler,
  asyncHandler
}