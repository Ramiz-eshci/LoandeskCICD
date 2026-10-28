/**
 * Night globe with a glowing UK — recreates the "UK lit up at night from
 * space" look with pure markup + CSS: starfield, gold pixel landmass with a
 * lit coastline, twinkling cities, a London ping, and a tilted satellite orbit.
 */
const MAP = [
  '..........111...........',
  '.........11111..........',
  '.........111111.........',
  '........1111111.........',
  '........11111111........',
  '.......111111111........',
  '.......111111111........',
  '.......11111111.........',
  '......111111111.........',
  '......11111111..........',
  '.......1111111..........',
  '.......111111...........',
  '......11111111..........',
  '......1111111...........',
  '.......111111...........',
  '......11111111..........',
  '.....1111111111.........',
  '.....11111111111........',
  '.....111111111111.......',
  '.11..111111111111.......',
  '111.11111111111111......',
  '111.111111111111111.....',
  '.11.111111111111111.....',
  '.1..11111111111111......',
  '...111111111111111......',
  '...11111111111111.......',
  '....11111111111111......',
  '.....111111111111.......',
  '...111111111111.........',
  '..11111111111...........',
  '.111111111..............',
  '.111111.................',
  '.1111...................',
  '..11....................',
];

/** Deterministic RNG so the stars/cities are stable between renders. */
function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Dot {
  r: number;
  c: number;
  coast: boolean;
  city: boolean;
  capital: boolean;
  delay: number;
}

const filled = new Set<string>();
MAP.forEach((row, r) => {
  for (let c = 0; c < row.length; c += 1) {
    if (row[c] === '1') filled.add(`${r}:${c}`);
  }
});

const rand = mulberry(42);
const DOTS: Dot[] = [];
filled.forEach((key) => {
  const [r, c] = key.split(':').map(Number);
  const coast = !(
    filled.has(`${r - 1}:${c}`) &&
    filled.has(`${r + 1}:${c}`) &&
    filled.has(`${r}:${c - 1}`) &&
    filled.has(`${r}:${c + 1}`)
  );
  const capital = r === 26 && c === 13; // London-ish
  const city = !coast && !capital && rand() < 0.3;
  DOTS.push({ r, c, coast, city, capital, delay: Math.round(rand() * 30) / 10 });
});

const starRand = mulberry(7);
const STARS = Array.from({ length: 80 }, () => ({
  x: Math.round(starRand() * 1000) / 10,
  y: Math.round(starRand() * 1000) / 10,
  s: starRand() < 0.75 ? 1.5 : 2.5,
  o: Math.round((0.25 + starRand() * 0.5) * 100) / 100,
  delay: Math.round(starRand() * 40) / 10,
}));

function dotClass(d: Dot) {
  if (d.capital) return 'px capital';
  if (d.coast) return 'px coast';
  if (d.city) return 'px city';
  return 'px';
}

export default function Globe() {
  return (
    <div className="globe" aria-hidden="true">
      <div className="globe-ball night">
        <div className="stars">
          {STARS.map((s, i) => (
            <i
              key={i}
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: s.s,
                height: s.s,
                opacity: s.o,
                animationDelay: `${s.delay}s`,
              }}
            />
          ))}
        </div>
        <div className="uk-aura">
          {DOTS.map((d) => (
            <i key={`${d.r}-${d.c}`} style={{ gridColumn: d.c + 1, gridRow: d.r + 1 }} />
          ))}
        </div>
        <div className="uk-land">
          {DOTS.map((d) => (
            <i
              key={`${d.r}-${d.c}`}
              className={dotClass(d)}
              style={{ gridColumn: d.c + 1, gridRow: d.r + 1, animationDelay: `${d.delay}s` }}
            >
              {d.capital ? <span className="cap-label">London</span> : null}
            </i>
          ))}
        </div>
        <div className="globe-sheen" />
      </div>
      <div className="orbit-tilt">
        <div className="orbit-ring" />
        <div className="orbit-spin"><span className="sat" /></div>
      </div>
    </div>
  );
}
