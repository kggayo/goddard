// Each provider owns cancellation; a late answer must never approve an abandoned request.
export function requestUser(adapter, id, request, reply) {
  adapter.requests ??= new Map();
  const controller = new AbortController();
  adapter.requests.set(id, controller);
  let answered = false;
  const respond = value => {
    if (answered || controller.signal.aborted) return;
    answered = true;
    adapter.requests.delete(id);
    if (!adapter.transport.closed) reply(value);
  };
  if (!adapter.emit('request', { ...request, signal: controller.signal, respond })) respond(null);
}

export function cancelRequests(adapter, id) {
  for (const [key, controller] of adapter.requests ?? []) {
    if (id !== undefined && key !== id) continue;
    controller.abort(); adapter.requests.delete(key);
  }
}
