// Bus de eventos en memoria (pub-sub) para notificar cambios de cierres a clientes SSE conectados.
// No persiste — si el backend reinicia, las conexiones SSE se reabren automaticamente (EventSource lo hace).
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0); // sin limite de listeners

function channelFor(closingId) {
  return `closing:${closingId}`;
}

// Emite un cambio. `kind` describe el tipo de cambio (p.ej. 'patch', 'photo', 'finalize').
export function emitClosingChange(closingId, kind = 'patch') {
  bus.emit(channelFor(closingId), { kind, at: Date.now() });
}

// Suscribe un handler a los cambios de un cierre. Retorna funcion para desuscribir.
export function onClosingChange(closingId, handler) {
  const ch = channelFor(closingId);
  bus.on(ch, handler);
  return () => bus.off(ch, handler);
}
