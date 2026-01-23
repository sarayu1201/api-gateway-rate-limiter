const express = require('express');

const app = express();
const PORT = process.env.MOCK_SERVICE_PORT || 4000;

const failRatio = parseFloat(process.env.MOCK_SERVICE_FAIL_RATIO || '0');
const delayMs = parseInt(process.env.MOCK_SERVICE_DELAY_MS || '0', 10) || 0;

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'mock-service' });
});

app.get('/data', async (req, res) => {
  try {
    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }

    if (failRatio > 0 && Math.random() < failRatio) {
      return res.status(503).json({ error: 'Downstream temporary error' });
    }

    res.status(200).json({ message: 'Hello from mock service /data' });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error' });
  }
});

app.listen(PORT, () => {
  console.log(`Mock service listening on port ${PORT}`);
});
