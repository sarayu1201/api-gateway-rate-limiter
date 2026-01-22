const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

const WINDOW_SECONDS = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || '60', 10);
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10', 10);

module.exports = async function rateLimiter(req, res, next) {
  try {
    const clientId = req.header('X-Client-ID') || 'anonymous';
    const path = req.path;
    const key = `rate:${clientId}:${path}`;

    const tx = redis.multi();
    tx.incr(key);
    tx.ttl(key);
    const [count, ttl] = await tx.exec().then(results => results.map(r => r[1]));

    if (ttl === -1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (count > MAX_REQUESTS) {
      const retryAfter = ttl > 0 ? ttl : WINDOW_SECONDS;
      res.set('Retry-After', retryAfter.toString());
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded',
        retry_after_seconds: retryAfter,
      });
    }

    next();
  } catch (err) {
    console.error('Rate limiter error', err);
    next();
  }
};
