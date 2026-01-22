const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

const FAILURE_THRESHOLD = parseInt(process.env.CB_FAILURE_THRESHOLD || '5', 10);
const RESET_TIMEOUT_MS = parseInt(process.env.CB_RESET_TIMEOUT_MS || '30000', 10);

async function getState(key) {
  const data = await redis.hgetall(key);
  if (!data || Object.keys(data).length === 0) {
    return { state: 'CLOSED', failures: 0, lastFailureTime: 0 };
  }
  return {
    state: data.state || 'CLOSED',
    failures: parseInt(data.failures || '0', 10),
    lastFailureTime: parseInt(data.lastFailureTime || '0', 10),
  };
}

async function setState(key, state) {
  await redis.hset(key, {
    state: state.state,
    failures: state.failures.toString(),
    lastFailureTime: state.lastFailureTime.toString(),
  });
}

async function circuitBreaker(req, res, next) {
  try {
    const key = 'cb:service-a';
    const now = Date.now();
    let state = await getState(key);

    if (state.state === 'OPEN') {
      if (now - state.lastFailureTime > RESET_TIMEOUT_MS) {
        state.state = 'HALF_OPEN';
        await setState(key, state);
      } else {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Circuit is open. Downstream service unstable.',
        });
      }
    }

    res.locals.cbKey = key;
    res.locals.cbState = state;
    next();
  } catch (err) {
    console.error('Circuit breaker pre-check error', err);
    next();
  }
}

async function afterProxy(error, statusCode, cbKey) {
  const now = Date.now();
  let state = await getState(cbKey);

  const isFailure = error || (statusCode >= 500 && statusCode <= 599);
  if (!isFailure) {
    if (state.state === 'HALF_OPEN') {
      state.state = 'CLOSED';
      state.failures = 0;
      state.lastFailureTime = 0;
      await setState(cbKey, state);
    }
    return;
  }

  state.failures += 1;
  state.lastFailureTime = now;

  if (state.failures >= FAILURE_THRESHOLD) {
    state.state = 'OPEN';
  }

  await setState(cbKey, state);
}

module.exports = circuitBreaker;
module.exports.afterProxy = afterProxy;
