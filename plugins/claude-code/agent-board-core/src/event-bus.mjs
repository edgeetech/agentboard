// Ported from hatice src/event-bus.ts — typed pub/sub EventBus with wildcard support.

import { EventEmitter } from 'node:events';

/**
 * Typed pub/sub event bus wrapping EventEmitter with wildcard (onAny) support.
 *
 * @template {Record<string, unknown[]>} TEvents
 */
export class EventBus {
  #emitter = new EventEmitter();
  #anyHandlers = new Set();

  /** @param {string} event @param {(...args:any[])=>void} handler */
  on(event, handler) { this.#emitter.on(event, handler); }

  /** @param {string} event @param {(...args:any[])=>void} handler */
  off(event, handler) { this.#emitter.off(event, handler); }

  /** @param {string} event @param {(...args:any[])=>void} handler */
  once(event, handler) { this.#emitter.once(event, handler); }

  /**
   * Emit an event. Fires both specific handlers and onAny handlers.
   * @param {string} event
   * @param {...unknown} args
   */
  emit(event, ...args) {
    this.#emitter.emit(event, ...args);
    for (const handler of this.#anyHandlers) {
      handler(event, ...args);
    }
  }

  /**
   * Register a wildcard handler that fires for every event.
   * Receives (eventName, ...eventArgs).
   * @param {(event:string, ...args:unknown[])=>void} handler
   */
  onAny(handler) { this.#anyHandlers.add(handler); }

  /** @param {(event:string, ...args:unknown[])=>void} handler */
  removeOnAny(handler) { this.#anyHandlers.delete(handler); }

  /** @param {string} event @returns {number} */
  listenerCount(event) { return this.#emitter.listenerCount(event); }

  removeAllListeners() {
    this.#emitter.removeAllListeners();
    this.#anyHandlers.clear();
  }
}

/** Singleton EventBus for agentboard run lifecycle events. */
export const agentboardBus = new EventBus();
