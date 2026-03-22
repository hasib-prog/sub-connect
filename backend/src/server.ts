import express from 'express';

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', port: PORT });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
