import type { SharedState, Versioned } from "./types";

/** The RPC surface of the KeyEscrowState Durable Object (cloudflare/state.ts). */
export interface KeyEscrowStateStub {
  get(key: string): Promise<Versioned<unknown> | null>;
  set(key: string, expected: number, value: unknown, ttlMs?: number): Promise<number | null>;
}

/** Just enough of a DurableObjectNamespace to reach the stub, so this file needs no Workers types. */
export interface KeyEscrowStateNamespace {
  idFromName(name: string): unknown;
  get(id: never): KeyEscrowStateStub;
}

/**
 * SharedState backed by one KeyEscrowState Durable Object instance (`name`, default "global"). The stub is looked up
 * per call: Worker I/O objects must not outlive the request that created them.
 */
export class DurableObjectState implements SharedState {
  readonly kind = "durable-object" as const;

  constructor(
    private readonly namespace: KeyEscrowStateNamespace,
    private readonly name = "global",
  ) {}

  private stub(): KeyEscrowStateStub {
    return this.namespace.get(this.namespace.idFromName(this.name) as never);
  }

  async get<T>(key: string): Promise<Versioned<T> | null> {
    return (await this.stub().get(key)) as Versioned<T> | null;
  }

  async set<T>(key: string, expected: number, value: T | null, opts: { ttlMs?: number } = {}): Promise<number | null> {
    return this.stub().set(key, expected, value, opts.ttlMs);
  }
}
