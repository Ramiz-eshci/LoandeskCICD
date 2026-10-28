import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { HERO_JOURNEY } from '../content';
import { CaseIcon, ChatIcon, LayersIcon, ShieldIcon, TrendIcon } from './icons';
import './LendingJourney.css';

const ICONS = { chat: ChatIcon, case: CaseIcon, shield: ShieldIcon, trend: TrendIcon };
const STAGE_DURATION = 5200;

function subscribeToMotionPreference(onChange: () => void) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  preference.addEventListener('change', onChange);
  return () => preference.removeEventListener('change', onChange);
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function LendingJourney() {
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, prefersReducedMotion, () => true);
  const playing = !paused && !reducedMotion;
  const current = HERO_JOURNEY[stage];
  const ActiveIcon = ICONS[current.icon];

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setStage((previous) => (previous + 1) % HERO_JOURNEY.length);
    }, STAGE_DURATION);
    return () => window.clearInterval(timer);
  }, [playing]);

  function selectStage(index: number) {
    setStage(index);
    setPaused(true);
  }

  return (
    <figure
      className="lending-journey"
      aria-labelledby="journey-title"
      data-playing={playing}
      style={{ '--stage': stage, '--stage-duration': `${STAGE_DURATION}ms` } as CSSProperties}
    >
      <div className="journey-heading">
        <div>
          <span className="journey-eyebrow">LOANDESK / ONE CONNECTED CASE</span>
          <h2 id="journey-title">From enquiry to live loan.</h2>
        </div>
        <span className="journey-brand-mark" aria-hidden="true">L</span>
      </div>

      <div className="journey-stages" role="group" aria-label="Explore a sample case through the lending lifecycle">
        <div className="journey-track" aria-hidden="true"><span /></div>
        {HERO_JOURNEY.map((item, index) => {
          const Icon = ICONS[item.icon];
          return (
            <button
              type="button"
              className={`journey-stage ${stage === index ? 'active' : ''} ${index < stage ? 'visited' : ''}`}
              key={item.label}
              aria-pressed={stage === index}
              aria-controls="journey-case"
              onClick={() => selectStage(index)}
            >
              <span className="journey-node"><Icon /></span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="journey-board">
        <div className="journey-evidence" aria-label="Information carried with the case">
          <span><LayersIcon /> Documents</span>
          <span><CaseIcon /> Terms</span>
          <span><ChatIcon /> Notes</span>
        </div>
        <svg className="journey-evidence-paths" viewBox="0 0 440 40" fill="none" preserveAspectRatio="none" aria-hidden="true">
          <path d="M73 0V9Q73 17 83 17H205Q220 17 220 30V40" />
          <path d="M220 0V40" />
          <path d="M367 0V9Q367 17 357 17H235Q220 17 220 30V40" />
          <path className="journey-data-trace" key={stage} pathLength="1" d="M73 0V9Q73 17 83 17H205Q220 17 220 30V40" />
        </svg>

        <div className="journey-case" id="journey-case">
          <div className="journey-case-header">
            <span><i aria-hidden="true" /> CASE / 002</span>
            <span className="journey-case-status" key={`status-${stage}`}>{current.status}</span>
          </div>
          <div className="journey-scene" key={stage}>
            <div className="journey-scene-heading">
              <span className="journey-scene-icon"><ActiveIcon /></span>
              <div><span className="journey-eyebrow">STAGE 0{stage + 1} / {current.label.toUpperCase()}</span><h3>{current.title}</h3></div>
            </div>
            <p className="journey-description">{current.description}</p>
            <div className="journey-records">
              {current.items.map((item, index) => (
                <div className="journey-record" key={item} style={{ '--row': index } as CSSProperties}>
                  <span className="journey-record-number">0{index + 1}</span>
                  <span>{item}</span>
                  <span className="journey-record-mark" aria-hidden="true">↗</span>
                </div>
              ))}
            </div>
            <div className="journey-handoff"><span className="journey-owner-dot" aria-hidden="true" /><span>{current.owner}</span><span aria-hidden="true">→</span><strong>{current.next}</strong></div>
          </div>
          <div className="journey-progress" aria-hidden="true"><span key={`${stage}-${playing}`} /></div>
        </div>

        <div className="journey-shared-record"><ShieldIcon /><span>Your team decides.<strong>LoanDesk connects the work.</strong></span><span className="journey-record-thread" aria-hidden="true" /></div>
      </div>

      <figcaption className="journey-caption">
        <span>Illustrative product view · sample data</span>
        <button type="button" className="journey-playback" disabled={reducedMotion} onClick={() => setPaused(!paused)} aria-label={reducedMotion ? 'Animation disabled by reduced motion preference' : playing ? 'Pause workflow animation' : 'Play workflow animation'}>
          <span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span>{reducedMotion ? 'Motion off' : playing ? 'Pause' : 'Play'}
        </button>
      </figcaption>
    </figure>
  );
}
