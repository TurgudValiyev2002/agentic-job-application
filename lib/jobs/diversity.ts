// Preserve ranking within each employer, but give other employers a turn.
export function diversifyEmployers<T>(items: T[], company: (item: T) => string, maxPerEmployer = Infinity): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = company(item).normalize("NFKC").trim().toLocaleLowerCase("en-US");
    const group = groups.get(key) ?? [];
    if (group.length < maxPerEmployer) group.push(item);
    groups.set(key, group);
  }
  const result: T[] = [];
  const longest = Math.max(0, ...[...groups.values()].map((group) => group.length));
  for (let index = 0; index < longest; index += 1) {
    for (const group of groups.values()) if (index < group.length) result.push(group[index]);
  }
  return result;
}

export function screeningPool<T extends { source: string; company: string; postedAt: Date | null }>(items: T[], limit: number): T[] {
  const sources = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0))) {
    sources.set(item.source, [...(sources.get(item.source) ?? []), item]);
  }
  const queues = [...sources.values()].map((group) => diversifyEmployers(group, (item) => item.company, 5));
  const result: T[] = [];
  for (let index = 0; result.length < limit && queues.some((queue) => index < queue.length); index += 1) {
    for (const queue of queues) if (index < queue.length && result.length < limit) result.push(queue[index]);
  }
  return result;
}
