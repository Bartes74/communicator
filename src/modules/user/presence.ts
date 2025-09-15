const onlineCounts = new Map<string, number>();

export function markOnline(userId: string): number {
  const count = (onlineCounts.get(userId) ?? 0) + 1;
  onlineCounts.set(userId, count);
  return count;
}

export function markOffline(userId: string): number {
  const current = onlineCounts.get(userId) ?? 0;
  const next = Math.max(0, current - 1);
  if (next === 0) {
    onlineCounts.delete(userId);
  } else {
    onlineCounts.set(userId, next);
  }
  return next;
}

export function isOnline(userId: string): boolean {
  return (onlineCounts.get(userId) ?? 0) > 0;
}

export function snapshotOnline(): string[] {
  return Array.from(onlineCounts.keys());
}


