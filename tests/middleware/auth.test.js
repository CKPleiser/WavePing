const { authenticateCron } = require('../../middleware/auth')

describe('Authentication Middleware', () => {
  let req, res, next

  beforeEach(() => {
    req = {
      headers: {}
    }
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    }
    next = jest.fn()
    
    // Set up environment variable
    process.env.CRON_SECRET = 'test-secret'
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('should call next() with valid authorization', () => {
    req.headers.authorization = 'Bearer test-secret'
    
    authenticateCron(req, res, next)
    
    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  test('should return 401 with missing authorization header', () => {
    authenticateCron(req, res, next)
    
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('should return 401 with invalid authorization token', () => {
    req.headers.authorization = 'Bearer wrong-secret'
    
    authenticateCron(req, res, next)
    
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('should return 401 with malformed authorization header', () => {
    req.headers.authorization = 'InvalidFormat'
    
    authenticateCron(req, res, next)
    
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    })
    expect(next).not.toHaveBeenCalled()
  })
})