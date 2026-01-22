# API Gateway with Advanced Rate Limiting and Circuit Breaker

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A production-ready API Gateway implementation in Node.js/Express that demonstrates advanced patterns for building resilient microservices: distributed rate limiting with Redis and circuit breaker pattern for fault tolerance.

## Features

- **Reverse Proxy**: Forward requests to downstream services
- **Distributed Rate Limiting**: Fixed-window counter algorithm using Redis
- **Circuit Breaker Pattern**: CLOSED → OPEN → HALF-OPEN state machine
- **Health Checks**: Integrated health check endpoints
- **Docker Compose**: Complete orchestration setup
- **Comprehensive Testing**: Unit and integration tests
- **API Documentation**: OpenAPI/Swagger specification
- **Environment Configuration**: All settings via env variables

## Quick Start with Docker

```bash
git clone https://github.com/sarayu1201/api-gateway-rate-limiter.git
cd api-gateway-rate-limiter
cp .env.example .env
docker-compose up
```

Services available at:
- Gateway: http://localhost:8080
- Mock Service: http://localhost:8081  
- Redis: localhost:6379

## Configuration

See `.env.example` for all environment variables. Key settings:

```env
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=10
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
CIRCUIT_BREAKER_RESET_TIMEOUT_SECONDS=30
```

## Rate Limiting

Rate limiting is applied per client per endpoint using `X-Client-ID` header.

```bash
curl -H "X-Client-ID: client1" http://localhost:8080/proxy/data
```

When rate limited (HTTP 429):
```json
{
  "error": "Too Many Requests",
  "retryAfter": 45
}
```

## Circuit Breaker

Implements standard three-state pattern:
- **CLOSED**: Normal operation
- **OPEN**: Service unhealthy, returns 503
- **HALF-OPEN**: Testing recovery

Opens after 3 consecutive failures. Resets after 30 seconds.

## Testing

```bash
npm test              # All tests
npm run test:unit     # Unit tests
npm run test:integration  # Integration tests
```

## Implementation Details

See `IMPLEMENTATION_GUIDE.md` for detailed code explanations of:
- RateLimiter class with Redis
- CircuitBreaker state machine
- Main gateway application
- Mock downstream service
- Dockerfiles configuration

## API Endpoints

### Health Check
```
GET /health
```

### Proxy
```
GET|POST|PUT|DELETE /proxy/*
Header: X-Client-ID: [client-id]

Responses:
200 - Success
429 - Rate limit exceeded
503 - Circuit breaker open
502 - Bad gateway
500 - Server error
```

## Architecture

The system consists of:
1. **API Gateway** - Express.js server with rate limiting and circuit breaker
2. **Redis** - Distributed state management for rate limit counters
3. **Mock Service** - Simulates backend with configurable failures

## Performance

- **Rate Limiter**: O(1) Redis operations per request
- **Circuit Breaker**: O(1) in-memory state checks
- **Proxy**: Non-blocking async/await
- **Concurrency**: Handles multiple concurrent clients

## License

MIT License - See LICENSE file for details

## Author

Vinaya Sarayu - Full-Stack Developer
