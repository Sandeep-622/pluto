import "server-only";

const windowMs = 60000;
const visitors = new Map<string, { started: number; count: number }>();
let active = 0;

export function reserveRequest(visitor: string): (() => void) | undefined {
  const now = Date.now();
  for (const [key, value] of visitors) {
    if (now - value.started >= windowMs) visitors.delete(key);
  }
  const current = visitors.get(visitor) ?? { started: now, count: 0 };
  if (active >= 4 || current.count >= 8 || (!visitors.has(visitor) && visitors.size >= 1000)) return undefined;
  current.count += 1;
  visitors.set(visitor, current);
  active += 1;
  let released = false;
  return () => {
    if (!released) { active -= 1; released = true; }
  };
}
