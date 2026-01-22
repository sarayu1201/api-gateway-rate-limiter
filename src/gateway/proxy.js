const { createProxyMiddleware: createHttpProxy } = require('http-proxy-middleware');
const { afterProxy } = require('./circuitBreaker');

function createProxyMiddleware(target) {
  return createHttpProxy({
    target,
    changeOrigin: true,
    pathRewrite: { '^/service-a': '' },
    onProxyRes: async (proxyRes, req, res) => {
      const cbKey = res.locals.cbKey;
      if (cbKey) {
        try {
          await afterProxy(null, proxyRes.statusCode, cbKey);
        } catch (e) {
          console.error('Circuit breaker onProxyRes error', e);
        }
      }
    },
    onError: async (err, req, res) => {
      const cbKey = res.locals.cbKey;
      if (cbKey) {
        try {
          await afterProxy(err, 502, cbKey);
        } catch (e) {
          console.error('Circuit breaker onError error', e);
        }
      }
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Gateway', message: 'Upstream error' }));
    },
  });
}

module.exports = { createProxyMiddleware };
