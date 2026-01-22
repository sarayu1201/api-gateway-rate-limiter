const express = require('express');
const morgan = require('morgan');
const rateLimitMiddleware = require('./rateLimiter');
const circuitBreakerMiddleware = require('./circuitBreaker');
const { createProxyMiddleware } = require('./proxy');

const app = express();
const PORT = process.env.GATEWAY_PORT || 3000;

app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'api-gateway' });
});

app.use(
  '/service-a',
  rateLimitMiddleware,
  circuitBreakerMiddleware,
  createProxyMiddleware(process.env.SERVICE_A_URL || 'http://mock-service:4000')
);

app.listen(PORT, () => {
  console.log(`API Gateway listening on port ${PORT}`);
});
