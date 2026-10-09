import { EventEmitter } from 'node:events';

export type EventHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void;
export type AnyEventHandler = (event: string, ...args: unknown[]) => void;

export class EventBus<TEvents extends Record<string, unknown[]> = Record<string, unknown[]>> {
  readonly #emitter = new EventEmitter();
  readonly #anyHandlers = new Set<AnyEventHandler>();

  on<K extends keyof TEvents & string>(event: K, handler: (...args: TEvents[K]) => void): void {
    this.#emitter.on(event, handler as (...args: unknown[]) => void);
  }

  off<K extends keyof TEvents & string>(event: K, handler: (...args: TEvents[K]) => void): void {
    this.#emitter.off(event, handler as (...args: unknown[]) => void);
  }

  once<K extends keyof TEvents & string>(event: K, handler: (...args: TEvents[K]) => void): void {
    this.#emitter.once(event, handler as (...args: unknown[]) => void);
  }

  emit<K extends keyof TEvents & string>(event: K, ...args: TEvents[K]): void {
    this.#emitter.emit(event, ...args);
    for (const handler of this.#anyHandlers) {
      handler(event, ...args);
    }
  }

  onAny(handler: AnyEventHandler): void {
    this.#anyHandlers.add(handler);
  }

  removeOnAny(handler: AnyEventHandler): void {
    this.#anyHandlers.delete(handler);
  }

  listenerCount(event: string): number {
    return this.#emitter.listenerCount(event);
  }

  removeAllListeners(): void {
    this.#emitter.removeAllListeners();
    this.#anyHandlers.clear();
  }
}

export const agentboardBus = new EventBus();

/** Payload for `skill-scan:started`. */
export interface SkillScanStartedPayload {
  scanId: string;
  projectCode: string;
  trigger: string;
}

/** Payload for `skill-scan:finished`. */
export interface SkillScanFinishedPayload {
  scanId: string;
  projectCode: string;
  status: 'succeeded' | 'failed';
  counts?: { added: number; updated: number; removed: number; found: number };
  error?: string;
}
