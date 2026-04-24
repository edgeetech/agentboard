import {
  ReactNode, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

type Placement = 'top' | 'bottom';

export function Tooltip({
  content,
  children,
  delay = 160,
  placement = 'top',
  maxWidth = 320,
  triggerClassName,
  triggerStyle,
}: {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
  placement?: Placement;
  maxWidth?: number;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; place: Placement } | null>(null);
  const timer = useRef<number | null>(null);

  function open() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(true), delay);
  }
  function close() {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    setVisible(false);
  }

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tipRef.current) return;
    const tr = triggerRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const gap = 8;
    let place: Placement = placement;
    let top = tr.top - tip.height - gap;
    if (top < 8) { place = 'bottom'; top = tr.bottom + gap; }
    let left = tr.left + tr.width / 2 - tip.width / 2;
    left = Math.min(Math.max(8, left), window.innerWidth - tip.width - 8);
    setPos({ top, left, place });
  }, [visible, content, placement]);

  return (
    <>
      <span
        ref={triggerRef}
        className={`ab-tt-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        style={triggerStyle}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
      >
        {children}
      </span>
      {visible && createPortal(
        <div
          ref={tipRef}
          role="tooltip"
          className={`ab-tooltip${pos ? ` place-${pos.place}` : ''}${pos ? ' visible' : ''}`}
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            maxWidth,
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
