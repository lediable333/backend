import express from 'express';
const app = express();
app.get('/health', (_req, res) => res.send('ok'));
app.listen(process.env.PORT || 8080);
