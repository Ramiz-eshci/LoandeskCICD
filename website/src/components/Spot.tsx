import { useRef, type ReactNode } from 'react';

/** Card with a cursor-tracked spotlight glow (Linear/Vercel-style hover). */
export default function Spot({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement | null>(null);

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
    el.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
  }

  return (
    <article ref={ref} onMouseMove={onMove} className={className}>
      {children}
    </article>
  );
}
