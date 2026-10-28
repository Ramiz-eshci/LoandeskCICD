import { useState } from 'react';
import EnquiryForm from './components/EnquiryForm';
import LendingJourney from './components/LendingJourney';
import Reveal from './components/Reveal';
import Spot from './components/Spot';
import { ChatIcon, LayersIcon, ShieldIcon, TrendIcon } from './components/icons';
import { APP_LOGIN_URL, CONTACT, CONTROLS, FAQS, MODULES, PROBLEMS, WORKFLOW } from './content';
import './App.css';

const ICONS = { chat: ChatIcon, layers: LayersIcon, shield: ShieldIcon, trend: TrendIcon };
const CURRENT_YEAR = new Date().getFullYear();
const NAV = [
  { href: '#platform', label: 'Platform' },
  { href: '#workflow', label: 'How it works' },
  { href: '#controls', label: 'Controls' },
  { href: '#faq', label: 'FAQ' },
];
function CasePreview({ stage }: { stage: number }) {
  const rows = [
    ['Applicant details', 'Proposed terms', 'Supporting documents', 'Assigned team member'],
    ['Initial review', 'Valuation instruction', 'KYC / AML', 'Findings & recommendation'],
    ['Facility overview', 'Payment schedule', 'Customer contact', 'Extension & redemption'],
  ][stage];
  return (
    <div className="case-preview">
      <div className="case-preview-head"><span className="ui-eyebrow">CONNECTED CASE RECORD</span><span className="case-preview-ref">CASE / 002</span></div>
      <div className="case-title-row"><h3>{WORKFLOW[stage].label}</h3><span className="case-mini-icon"><LayersIcon /></span></div>
      <div className="case-step-line" aria-hidden="true">{['Intake', 'Review', 'Servicing'].map((label, index) => <span className={index <= stage ? 'reached' : ''} key={label}><i />{label}</span>)}</div>
      <div className="case-checklist">{rows.map((row, index) => <div key={row}><span className={index < 2 ? 'check-indicator checked' : 'check-indicator'} aria-hidden="true">{index < 2 ? '✓' : '·'}</span><span>{row}</span><small>{index < 2 ? 'Recorded' : 'To review'}</small></div>)}</div>
      <div className="case-activity"><span className="activity-avatar" aria-hidden="true">LD</span><div><strong>Context travels with the case.</strong><span>Documents, notes and ownership in one record.</span></div></div>
      <p className="case-preview-caption">Illustrative workflow · sample case</p>
    </div>
  );
}

export default function App() {
  const [activeStage, setActiveStage] = useState(0);

  return (
    <div className="site" id="top">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="wrap header-inner">
          <a className="brand" href="#top" aria-label="LoanDesk home"><img src="/logo-navy.png" alt="LoanDesk" width="160" height="40" /></a>
          <nav className="header-nav" aria-label="Primary">{NAV.map((item) => <a href={item.href} key={item.href}>{item.label}</a>)}</nav>
          <a className="header-cta" href={APP_LOGIN_URL}>Get started <span aria-hidden="true">↗</span></a>
          <details className="mobile-menu"><summary>Menu <span aria-hidden="true">+</span></summary><nav aria-label="Mobile navigation">{NAV.map((item) => <a href={item.href} key={item.href} onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}>{item.label}</a>)}<a href={APP_LOGIN_URL}>Get started ↗</a><a href="#demo" onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}>Book a demo ↗</a></nav></details>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-uk-map" aria-hidden="true"><img src="/images/uk-lending-map.svg" alt="" width="420" height="660" /></div>
          <svg className="hero-connections" viewBox="0 0 1440 840" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <path className="connection-line" d="M-60 540C180 540 230 140 530 230S780 590 1160 220S1420 290 1520 140" />
            <path className="connection-line secondary" d="M-80 590C170 590 265 200 550 280S900 730 1450 480" />
            <path className="connection-trace" pathLength="1" d="M-60 540C180 540 230 140 530 230S780 590 1160 220S1420 290 1520 140" />
          </svg>
          <div className="wrap hero-inner">
            <div className="hero-copy">
              <Reveal><p className="eyebrow"><span /> BUILT FOR SPECIALIST LENDING TEAMS</p><h1 id="hero-title">Every case.<br />Every team.<br /><em>One workspace.</em></h1></Reveal>
              <Reveal delay={100}><p className="hero-lede">The workspace for specialist lenders. Move each deal from enquiry and application through underwriting to the live portfolio—with the evidence, ownership and history carried forward.</p><div className="hero-actions"><a className="btn-primary" href="#demo">Book a demo <span aria-hidden="true">↗</span></a><a className="text-link" href="#workflow">Explore the workflow <span aria-hidden="true">↓</span></a></div><p className="hero-footnote"><ShieldIcon /> Your team’s expertise. A clearer way to work.</p></Reveal>
            </div>
            <Reveal delay={160}><LendingJourney /></Reveal>
          </div>
          <div className="wrap hero-bottom"><span className="hero-bottom-label">ONE CONNECTED LIFECYCLE</span><div>{['Enquiry', 'Application', 'Underwriting', 'Portfolio'].map((label, index) => <span key={label}>{index > 0 ? <i aria-hidden="true">→</i> : null}{label}</span>)}</div></div>
        </section>

        <section className="problem-section section" aria-labelledby="problem-title">
          <div className="wrap">
            <Reveal><div className="section-label"><span>01 / THE CHALLENGE</span><span>LENDING IS COMPLEX. THE WORKSPACE SHOULDN’T BE.</span></div><div className="section-heading"><h2 id="problem-title">Good lending takes judgement.<br /><em>Not another spreadsheet.</em></h2><p>Your people need time to assess the deal. Give them a shared view of the work, rather than another place to look for it.</p></div></Reveal>
            <div className="problem-grid">{PROBLEMS.map((problem, index) => <Reveal key={problem.title} delay={index * 70}><article className="problem"><span className="problem-number">P / 0{index + 1}</span><h3>{problem.title}</h3><p>{problem.body}</p></article></Reveal>)}</div>
          </div>
        </section>

        <section className="workflow-section section" id="workflow" aria-labelledby="workflow-title">
          <div className="wrap">
            <Reveal><div className="section-label"><span>02 / THE WORKFLOW</span><span>THE FILE MOVES. THE CONTEXT STAYS.</span></div><div className="section-heading"><h2 id="workflow-title">Follow the deal.<br /><em>All the way through.</em></h2><p>From the first conversation to the live loan, each team works with the record that came before it.</p></div></Reveal>
            <div className="workflow-layout">
              <div className="workflow-copy">
                <div className="workflow-selector" role="group" aria-label="Explore the lending workflow">{WORKFLOW.map((stage, index) => <button type="button" className={activeStage === index ? 'workflow-button active' : 'workflow-button'} aria-pressed={activeStage === index} aria-controls="workflow-detail" onClick={() => setActiveStage(index)} key={stage.label}><span>0{index + 1}</span>{stage.label}<span className="workflow-arrow" aria-hidden="true">↗</span></button>)}</div>
                <div id="workflow-detail" className="workflow-detail" role="region" aria-label={WORKFLOW[activeStage].label} aria-live="polite"><h3>{WORKFLOW[activeStage].title}</h3><p>{WORKFLOW[activeStage].body}</p><ul>{WORKFLOW[activeStage].items.map((item) => <li key={item}><span aria-hidden="true">✓</span>{item}</li>)}</ul><p className="workflow-detail-note">{WORKFLOW[activeStage].detail}</p></div>
              </div>
              <CasePreview key={activeStage} stage={activeStage} />
            </div>
          </div>
        </section>

        <section className="platform-section section" id="platform" aria-labelledby="platform-title">
          <div className="wrap">
            <Reveal><div className="section-label"><span>03 / THE PLATFORM</span><span>BUILT AROUND THE WORK YOU DO.</span></div><div className="section-heading"><h2 id="platform-title">A lending desk.<br /><em>Working together.</em></h2><p>Connected workspaces for the people originating, reviewing and managing your loans.</p></div></Reveal>
            <div className="module-grid">{MODULES.map((module, index) => {
              const Icon = ICONS[module.icon];
              return <Reveal key={module.title} delay={(index % 2) * 80}><Spot className="module-card"><div className="module-card-top"><span className="module-icon"><Icon /></span><span className="module-number">MODULE / 0{index + 1}</span></div><h3>{module.title}</h3><p>{module.body}</p><ul className="module-tags" aria-label={`${module.title} capabilities`}>{module.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul><a className="module-link" href="#demo">Explore in a demo <span aria-hidden="true">↗</span></a></Spot></Reveal>;
            })}</div>
            <Reveal><div className="platform-note"><span className="platform-note-mark" aria-hidden="true">↳</span><p>One record through the lifecycle.<br /><strong>Less reconstruction between teams.</strong></p><a className="text-link" href="#demo">Let’s look at your workflow <span aria-hidden="true">↗</span></a></div></Reveal>
          </div>
        </section>

        <section className="controls-section section" id="controls" aria-labelledby="controls-title">
          <div className="wrap controls-layout">
            <Reveal><div className="controls-copy"><div className="section-label"><span>04 / CONTROL & ACCOUNTABILITY</span></div><h2 id="controls-title">Clear ownership.<br /><em>A traceable history.</em></h2><p className="section-intro">A shared workspace needs boundaries. LoanDesk brings role permissions, review requirements and audit records into the lending process.</p><a className="text-link" href="#demo">Discuss your requirements <span aria-hidden="true">↗</span></a></div></Reveal>
            <div className="controls-list">{CONTROLS.map((control, index) => <Reveal key={control.title} delay={index * 60}><article><span className="control-number">0{index + 1}</span><div><h3>{control.title}</h3><p>{control.body}</p></div><ShieldIcon /></article></Reveal>)}</div>
          </div>
        </section>

        <section className="faq-section section" id="faq" aria-labelledby="faq-title">
          <div className="wrap faq-layout">
            <Reveal><div className="section-label"><span>05 / QUESTIONS, ANSWERED</span></div><h2 id="faq-title">Before you<br /><em>take a closer look.</em></h2><p className="section-intro">A few things your team might want to know.</p><a className="text-link" href="#demo">Talk to us <span aria-hidden="true">↗</span></a></Reveal>
            <div className="faq-list">{FAQS.map((faq, index) => <details className="faq-item" key={faq.q}><summary><span className="faq-number">0{index + 1}</span><span>{faq.q}</span><span className="faq-plus" aria-hidden="true">+</span></summary><p>{faq.a}</p></details>)}</div>
          </div>
        </section>

        <section className="demo-section section" id="demo" aria-labelledby="demo-title">
          <div className="wrap demo-layout">
            <Reveal><div className="demo-copy"><div className="section-label"><span>06 / YOUR NEXT STEP</span></div><h2 id="demo-title">Let’s start with<br /><em>your lending desk.</em></h2><p>See how LoanDesk fits the way your team works. Tell us about your process, and we’ll focus the conversation on what matters to you.</p><ol className="demo-expectations"><li><span>01</span><div><h3>Your workflow</h3><p>Where cases start, how teams hand over, and what needs attention.</p></div></li><li><span>02</span><div><h3>A platform walkthrough</h3><p>Explore the workspaces relevant to your lending operation.</p></div></li><li><span>03</span><div><h3>A practical conversation</h3><p>Discuss requirements, deployment and the next steps for your firm.</p></div></li></ol>{CONTACT.email ? <a className="demo-email" href={`mailto:${CONTACT.email}`}>{CONTACT.email} <span aria-hidden="true">↗</span></a> : null}</div></Reveal>
            <Reveal delay={100}><EnquiryForm /></Reveal>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap footer-main"><div><a className="brand footer-brand" href="#top" aria-label="LoanDesk home"><img src="/logo.png" alt="LoanDesk" width="160" height="40" /></a><p>Every case. Every team. One workspace.</p></div><nav aria-label="Footer">{NAV.map((item) => <a href={item.href} key={item.href}>{item.label}</a>)}<a href={APP_LOGIN_URL}>Get started ↗</a><a href="#demo">Book a demo ↗</a></nav></div>
        <div className="wrap footer-base"><span>© {CURRENT_YEAR} LoanDesk. All rights reserved.</span><span>Lending operations, connected.</span></div>
      </footer>
    </div>
  );
}
