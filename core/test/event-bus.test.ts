import { describe, it, expect, vi } from 'vitest';

import { EventBus } from '../src/event-bus.ts';

describe('EventBus', () => {
  it('subscribe to an event and emit it — handler is called', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('task:done', handler);
    bus.emit('task:done', { id: '1' });
    expect(handler).toHaveBeenCalledWith({ id: '1' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe — handler is NOT called after off()', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('task:done', handler);
    bus.off('task:done', handler);
    bus.emit('task:done', { id: '2' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple subscribers all receive the same event', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();
    bus.on('run:start', h1);
    bus.on('run:start', h2);
    bus.on('run:start', h3);
    bus.emit('run:start', 'payload');
    expect(h1).toHaveBeenCalledWith('payload');
    expect(h2).toHaveBeenCalledWith('payload');
    expect(h3).toHaveBeenCalledWith('payload');
  });

  it('emitting with no subscribers does not throw', () => {
    const bus = new EventBus();
    expect(() => {
      bus.emit('no:listeners', 'data');
    }).not.toThrow();
  });

  it('once() handler fires only once', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('ping', handler);
    bus.emit('ping');
    bus.emit('ping');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('onAny() handler fires for every event', () => {
    const bus = new EventBus();
    const anyHandler = vi.fn();
    bus.onAny(anyHandler);
    bus.emit('evt1', 'a');
    bus.emit('evt2', 'b');
    expect(anyHandler).toHaveBeenCalledTimes(2);
    expect(anyHandler).toHaveBeenCalledWith('evt1', 'a');
    expect(anyHandler).toHaveBeenCalledWith('evt2', 'b');
  });

  it('removeOnAny() stops the wildcard handler', () => {
    const bus = new EventBus();
    const anyHandler = vi.fn();
    bus.onAny(anyHandler);
    bus.emit('evt1');
    bus.removeOnAny(anyHandler);
    bus.emit('evt2');
    expect(anyHandler).toHaveBeenCalledTimes(1);
  });

  it('listenerCount returns correct count', () => {
    const bus = new EventBus();
    const h = vi.fn();
    expect(bus.listenerCount('x')).toBe(0);
    bus.on('x', h);
    expect(bus.listenerCount('x')).toBe(1);
    bus.off('x', h);
    expect(bus.listenerCount('x')).toBe(0);
  });

  it('removeAllListeners() clears everything', () => {
    const bus = new EventBus();
    const h = vi.fn();
    const any = vi.fn();
    bus.on('evt', h);
    bus.onAny(any);
    bus.removeAllListeners();
    bus.emit('evt');
    expect(h).not.toHaveBeenCalled();
    expect(any).not.toHaveBeenCalled();
  });
});
