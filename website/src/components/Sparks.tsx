/** Rising gold-dust particles for the apply section backdrop. Deterministic. */
const PARTICLES = (() => {
  let seed = 11;
  const rnd = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 26 }, () => ({
    left: Math.round(rnd() * 1000) / 10,
    size: Math.round((2 + rnd() * 4) * 10) / 10,
    dur: Math.round((7 + rnd() * 8) * 10) / 10,
    delay: Math.round(rnd() * 120) / 10,
    sway: Math.round((rnd() * 120 - 60) * 10) / 10,
    o: Math.round((0.35 + rnd() * 0.55) * 100) / 100,
  }));
})();

export default function Sparks() {
  return (
    <div className="sparks" aria-hidden="true">
      {PARTICLES.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            opacity: p.o,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
            ['--sway' as string]: `${p.sway}px`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
