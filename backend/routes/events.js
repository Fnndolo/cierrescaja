import express from 'express';
import { onClosingChange } from '../services/eventBus.js';

const router = express.Router();

// GET /api/events?closingId=N
// Server-Sent Events: mantiene la conexion abierta y empuja eventos cuando el cierre cambia.
// El frontend usa EventSource para suscribirse.
router.get('/', (req, res) => {
  const closingId = req.query.closingId;
  if (!closingId) return res.status(400).end('falta closingId');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // desactiva buffering en proxies tipo nginx
  res.flushHeaders();

  // Mensaje inicial para confirmar la conexion
  res.write(`event: hello\ndata: ${JSON.stringify({ closingId })}\n\n`);

  const send = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const unsubscribe = onClosingChange(closingId, (change) => {
    send('change', change);
  });

  // Heartbeat cada 25s para que proxies/load balancers no cierren la conexion idle.
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
