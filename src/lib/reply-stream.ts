type Listener = (delta: string) => void;

const listeners = new Map<string, Set<Listener>>();

export function emitReplyDelta(threadId: string, delta: string): void {
  for (const cb of listeners.get(threadId) ?? []) cb(delta);
}

export function onReplyDelta(threadId: string, cb: Listener): () => void {
  let set = listeners.get(threadId);
  if (!set) listeners.set(threadId, (set = new Set()));
  set.add(cb);
  return () => {
    set.delete(cb);
    if (!set.size && listeners.get(threadId) === set) listeners.delete(threadId);
  };
}
