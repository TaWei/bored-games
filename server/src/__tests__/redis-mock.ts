// ============================================================
// MOCK REDIS — In-memory replacement for ioredis in tests
// ============================================================

type ExpiryOption = 'EX' | 'PX' | 'EXAT' | 'PXAT' | 'KEEPTTL';
type ScoreMember = { score: number; member: string };

export class MockRedis {
  private store = new Map<string, string>();
  private zsets = new Map<string, ScoreMember[]>();
  private ttls = new Map<string, number>();
  private subscribers = new Map<string, Set<(msg: string) => void>>();
  private expiryIntervals = new Map<string, ReturnType<typeof setTimeout>>();

  // ----- String operations -----

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    ex?: ExpiryOption,
    msOrSec?: number
  ): Promise<'OK'> {
    this.store.set(key, value);
    if (ex === 'PX' && msOrSec !== undefined) {
      this.ttls.set(key, msOrSec);
      this.scheduleExpiry(key, msOrSec);
    } else if (ex === 'EX' && msOrSec !== undefined) {
      this.ttls.set(key, msOrSec * 1000);
      this.scheduleExpiry(key, msOrSec * 1000);
    }
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
      this.zsets.delete(key);
      this.ttls.delete(key);
      this.clearExpiry(key);
    }
    return count;
  }

  async exists(...keys: string[]): Promise<number> {
    return keys.filter((k) => this.store.has(k)).length;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.store.has(key)) return 0;
    this.ttls.set(key, seconds * 1000);
    this.scheduleExpiry(key, seconds * 1000);
    return 1;
  }

  // ----- Sorted set operations (zadd, zrange, zrank, zrem, zcard, zremrangebyscore) -----

  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.zsets.has(key)) {
      this.zsets.set(key, []);
    }
    const set = this.zsets.get(key)!;
    const idx = set.findIndex((sm) => sm.member === member);
    if (idx >= 0) {
      set[idx]!.score = score;
      return 0;
    }
    set.push({ score, member });
    set.sort((a, b) => a.score - b.score);
    return 1;
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const set = this.zsets.get(key) ?? [];
    const end = stop < 0 ? set.length + stop + 1 : stop + 1;
    return set.slice(start, end).map((sm) => sm.member);
  }

  async zrank(key: string, member: string): Promise<number | null> {
    const set = this.zsets.get(key);
    if (!set) return null;
    const idx = set.findIndex((sm) => sm.member === member);
    return idx >= 0 ? idx : null;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const set = this.zsets.get(key);
    if (!set) return 0;
    let count = 0;
    for (const m of members) {
      const idx = set.findIndex((sm) => sm.member === m);
      if (idx >= 0) {
        set.splice(idx, 1);
        count++;
      }
    }
    return count;
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.length ?? 0;
  }

  async zremrangebyscore(
    key: string,
    min: number,
    max: number
  ): Promise<number> {
    const set = this.zsets.get(key);
    if (!set) return 0;
    const before = set.length;
    const filtered = set.filter((sm) => sm.score < min || sm.score > max);
    this.zsets.set(key, filtered);
    return before - filtered.length;
  }

  // ----- Pub/Sub -----

  async subscribe(channel: string): Promise<void> {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    this.subscribers.delete(channel);
  }

  on(
    event: 'message',
    handler: (channel: string, message: string) => void
  ): void {
    if (event === 'message') {
      // Store the handler for later trigger
      const channel = '__handler_channel__';
      if (!this.subscribers.has(channel)) {
        this.subscribers.set(channel, new Set());
      }
      (this.subscribers.get(channel) as Set<string>).add(channel);
      // We use a separate map to store handlers
      const handlers = (this as any)._messageHandlers as Map<
        string,
        (channel: string, message: string) => void
      >;
      if (!handlers) {
        (this as any)._messageHandlers = new Map();
      }
      (this as any)._messageHandlers.set(channel, handler);
    }
  }

  async publish(channel: string, message: string): Promise<number> {
    const handlers = (this as any)._messageHandlers as Map<
      string,
      (channel: string, message: string) => void
    >;
    const handler = handlers?.get(channel);
    if (handler) {
      handler(channel, message);
    }
    return 1;
  }

  // ----- Utility -----

  clear(): void {
    this.store.clear();
    this.zsets.clear();
    this.ttls.clear();
    this.subscribers.clear();
    for (const t of this.expiryIntervals.values()) {
      clearTimeout(t);
    }
    this.expiryIntervals.clear();
  }

  private scheduleExpiry(key: string, ms: number): void {
    this.clearExpiry(key);
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.ttls.delete(key);
      this.expiryIntervals.delete(key);
    }, ms);
    this.expiryIntervals.set(key, timer);
  }

  private clearExpiry(key: string): void {
    const existing = this.expiryIntervals.get(key);
    if (existing) {
      clearTimeout(existing);
      this.expiryIntervals.delete(key);
    }
  }

  // Expose store for assertions
  getStore(): Map<string, string> {
    return this.store;
  }

  getZSets(): Map<string, ScoreMember[]> {
    return this.zsets;
  }
}
