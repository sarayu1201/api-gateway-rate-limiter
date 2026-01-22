
const express = require('express');
const morgan = require('morgan');

const app = express();
const PORT = process.env.MOCK_SERVICE_PORT || 4000;

app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'mock-service' });
});

app.get('/test', async (req, res) => {
  const failureRate = parseFloat(process.env.MOCK_FAILURE_RATE || '0.3');
  const delayMs = parseInt(process.env.MOCK_DELAY_MS || '0', 10);

  if (delayMs > 0) {
    await new Promise(r => setTimeout(r, delayMs));
  }

  if (Math.random() < failureRate) {
    return res.status(503).json({ error: 'Mock failure', message: 'Injected failure for testing' });
  }

  res.json({ data: 'Mock service success', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`Mock service listening on port ${PORT}`);
});
