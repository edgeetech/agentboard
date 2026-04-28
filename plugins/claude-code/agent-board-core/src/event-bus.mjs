// Typed pub/sub EventBus with wildcard support.

import { EventEmitter } from 'node:events';

export class EventBus {
  #emitter = new EventEmitter();
  #anyHandlers = new Set();

  /** @param {string} event @param {(...args:any[])=>void} handler */
  on(event, handler) { this.#emitter.on(event, handler); }

  /** @param {string} event @param {(...args:any[])=>void} handler */
  off(event, handler) { this.#emitter.off(event, handler); }

  /** @param {string} event @param {(...args:any[])=>void} handler */
  once(event, handler) { this.#emitter.once(event, handler); }

  emit(event, ...args) {
    this.#emitter.emit(event, ...args);
    for (const handler of this.#anyHandlers) handler(event, ...args);
  }

  onAny(handler) { this.#anyHandlers.add(handler); }
  removeOnAny(handler) { this.#anyHandlers.delete(handler); }

  listenerCount(event) { return this.#emitter.listenerCount(event); }

  removeAllListeners() {
    this.#emitter.removeAllListeners();
    this.#anyHandlers.clear();
  }
}

/** Singleton EventBus for agentboard run lifecycle events. */
export const agentboardBus = new EventBus();
