# API Gateway Implementation Guide

## Complete Project Structure

This guide contains all necessary files for the API Gateway project.

### Directory Structure
```
api-gateway-rate-limiter/
├── src/
│   ├── gateway/
│   │   ├── main.js                  # Gateway server entry point
│   │   ├── middlewares/
│   │   │   ├── rateLimiter.js      # Rate limiting middleware
│   │   │   ├── circuitBreaker.js   # Circuit breaker middleware
│   │   │   └── errorHandler.js     # Error handling
│   │   ├── services/
│   │   │   └── downstreamClient.js # Downstream service caller
│   │   └── config/
│   │       └── config.js            # Configuration loader
│   └── mock_service/
│       └── app.js                  # Mock downstream service
├── tests/
│   ├── unit/
│   │   ├── rateLimiter.test.js
│   │   └── circuitBreaker.test.js
│   └── integration/
│       └── gateway.integration.test.js
├── docker-compose.yml
├── Dockerfile                      # Gateway service
├── Dockerfile.mock                 # Mock service
├── package.json
├── .env.example
├── openapi.yaml                    # API documentation
├── jest.config.js                  # Jest configuration
└── README.md

## File Contents

### 1. src/gateway/config/config.js
```javascript
require('dotenv').config();

module.exports = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'),
  },
  gateway: {
    port: parseInt(process.env.PORT || '8080'),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  downstreamService: {
    url: process.env.DOWNSTREAM_SERVICE_URL || 'http://localhost:8081',
    timeoutSeconds: parseInt(process.env.DOWNSTREAM_SERVICE_TIMEOUT_SECONDS || '5'),
  },
  rateLimit: {
    windowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || '60'),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10'),
  },
  circuitBreaker: {
    failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '3'),
    resetTimeoutSeconds: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_SECONDS || '30'),
  },
};
```

### 2. src/gateway/middlewares/rateLimiter.js
```javascript
const redis = require('redis');
const config = require('../config/config');

class RateLimiter {
  constructor() {
    this.client = redis.createClient({
      host: config.redis.host,
      port: config.redis.port,
      db: config.redis.db,
    });
    this.client.on('error', (err) => console.error('Redis error:', err));
  }

  async connect() {
    await this.client.connect();
  }

  async checkRequest(clientId, endpoint) {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % config.rateLimit.windowSeconds);
    const key = `rate_limit:${clientId}:${endpoint}:${windowStart}`;

    try {
      const count = await this.client.incr(key);
      
      if (count === 1) {
        await this.client.expire(key, config.rateLimit.windowSeconds);
      }

      const allowed = count <= config.rateLimit.maxRequests;
      const retryAfter = allowed ? 0 : config.rateLimit.windowSeconds - (now % config.rateLimit.windowSeconds);
      
      return { allowed, count, retryAfter };
    } catch (err) {
      console.error('Rate limiter error:', err);
      return { allowed: true, count: 0, retryAfter: 0 };
    }
  }

  async disconnect() {
    await this.client.quit();
  }
}

module.exports = new RateLimiter();
```

### 3. src/gateway/middlewares/circuitBreaker.js
```javascript
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeout = options.resetTimeout || 30000;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  async executeRequest(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttemptTime) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        const error = new Error('Circuit breaker is OPEN');
        error.statusCode = 503;
        throw error;
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  recordSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      console.log('[CircuitBreaker] Transitioned to CLOSED');
    }
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.resetTimeout;
      console.log('[CircuitBreaker] Transitioned to OPEN (from HALF_OPEN)');
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.resetTimeout;
      console.log('[CircuitBreaker] Transitioned to OPEN');
    }
  }

  getState() {
    return this.state;
  }
}

module.exports = CircuitBreaker;
```

### 4. src/gateway/services/downstreamClient.js
```javascript
const axios = require('axios');
const config = require('../config/config');
const CircuitBreaker = require('../middlewares/circuitBreaker');

const circuitBreaker = new CircuitBreaker({
  failureThreshold: config.circuitBreaker.failureThreshold,
  resetTimeout: config.circuitBreaker.resetTimeoutSeconds * 1000,
});

class DownstreamClient {
  async callDownstream(endpoint, method = 'GET', data = null) {
    const url = `${config.downstreamService.url}${endpoint}`;
    
    return circuitBreaker.executeRequest(async () => {
      try {
        const response = await axios({
          method,
          url,
          data,
          timeout: config.downstreamService.timeoutSeconds * 1000,
        });
        return response;
      } catch (err) {
        if (err.response) {
          throw new Error(`Downstream error: ${err.response.status}`);
        } else if (err.code === 'ECONNABORTED') {
          throw new Error('Downstream timeout');
        }
        throw err;
      }
    });
  }

  getCircuitState() {
    return circuitBreaker.getState();
  }
}

module.exports = new DownstreamClient();
```

### 5. src/gateway/main.js
```javascript
const express = require('express');
const rateLimiter = require('./middlewares/rateLimiter');
const downstreamClient = require('./services/downstreamClient');
const config = require('./config/config');

const app = express();

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Rate limiting middleware
app.use(async (req, res, next) => {
  const clientId = req.headers['x-client-id'] || 'anonymous';
  const endpoint = req.path;
  
  const { allowed, retryAfter } = await rateLimiter.checkRequest(clientId, endpoint);
  
  if (!allowed) {
    return res.status(429).json({
      error: 'Too Many Requests',
      retryAfter,
    }).set('Retry-After', retryAfter.toString());
  }
  
  next();
});

// Proxy endpoint
app.all('/proxy/*', async (req, res) => {
  try {
    const endpoint = req.params[0] ? `/${req.params[0]}` : '/';
    const response = await downstreamClient.callDownstream(endpoint, req.method, req.body);
    res.status(response.status).json(response.data);
  } catch (err) {
    if (err.message.includes('Circuit breaker is OPEN')) {
      return res.status(503).json({ error: 'Service Unavailable' });
    }
    res.status(502).json({ error: 'Bad Gateway', details: err.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
const startServer = async () => {
  try {
    await rateLimiter.connect();
    app.listen(config.gateway.port, () => {
      console.log(`Gateway listening on port ${config.gateway.port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = app;
```

### 6. src/mock_service/app.js
```javascript
const express = require('express');
const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/data', (req, res) => {
  const failRatio = parseFloat(process.env.MOCK_SERVICE_FAIL_RATIO || '0.3');
  const delayMs = parseInt(process.env.MOCK_SERVICE_DELAY_MS || '0');

  if (Math.random() < failRatio) {
    return res.status(500).json({ error: 'Internal Server Error from Mock' });
  }

  if (delayMs > 0) {
    setTimeout(() => {
      res.status(200).json({ data: 'Hello from Mock Service!' });
    }, delayMs);
  } else {
    res.status(200).json({ data: 'Hello from Mock Service!' });
  }
});

app.listen(8081, () => {
  console.log('Mock service running on port 8081');
});
```

### 7. Dockerfile (Gateway)
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=3 CMD wget -q0- http://localhost:8080/health || exit 1
CMD ["npm", "start"]
```

### 8. Dockerfile.mock
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8081
CMD ["npm", "run", "mock-service"]
```

## Quick Start

1. Clone and prepare:
   ```bash
   git clone https://github.com/yourusername/api-gateway-rate-limiter.git
   cd api-gateway-rate-limiter
   cp .env.example .env
   npm install
   ```

2. Run with Docker:
   ```bash
   docker-compose up
   ```

3. Test the gateway:
   ```bash
   # Make requests with X-Client-ID header
   curl -H "X-Client-ID: client1" http://localhost:8080/proxy/data
   ```

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration
```
