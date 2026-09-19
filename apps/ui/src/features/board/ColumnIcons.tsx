/* Inline SVG icons for each board column. All animations are CSS-driven
   (see styles.css :: .col-icon-*). Keep shapes chunky + monochrome — they
   render at ~18–20 px next to the column label and should read clearly. */

function Base({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <svg
      className={`col-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Floating cloud → "ideas land here". */
export function CloudIcon() {
  return (
    <Base className="col-icon-cloud">
      <g className="cloud-float">
        <path d="M7 17a4 4 0 0 1-.8-7.92 5 5 0 0 1 9.7-1.32A4 4 0 1 1 16.5 17H7Z" />
        <circle className="spark s1" cx="17.5" cy="5"  r="0.6" />
        <circle className="spark s2" cx="20"   cy="8"  r="0.5" />
        <circle className="spark s3" cx="5"    cy="6"  r="0.5" />
      </g>
    </Base>
  );
}

/** Robot with spinning antenna dot + pulsing eye — "agent is on it". */
export function RobotIcon() {
  return (
    <Base className="col-icon-robot">
      <rect x="5" y="8" width="14" height="10" rx="2.5" />
      <line x1="12" y1="5" x2="12" y2="8" />
      <circle className="robot-antenna" cx="12" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle className="robot-eye le" cx="9.5"  cy="12.5" r="1.1" fill="currentColor" stroke="none" />
      <circle className="robot-eye re" cx="14.5" cy="12.5" r="1.1" fill="currentColor" stroke="none" />
      <path className="robot-mouth" d="M9.5 15.5h5" />
      <line x1="3" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="21" y2="12" />
    </Base>
  );
}

/** Magnifying glass for Agent Review (not requested but keeps WF1 column
    row visually consistent). Subtle hover-only tilt. */
export function LoupeIcon() {
  return (
    <Base className="col-icon-loupe">
      <circle cx="11" cy="11" r="5.5" />
      <line x1="15" y1="15" x2="19" y2="19" />
      <line className="glint" x1="9" y1="8" x2="10.5" y2="9.5" />
    </Base>
  );
}

/** Human head + checklist with a check that draws in on loop. */
export function ChecklistIcon() {
  return (
    <Base className="col-icon-check">
      {/* human head + shoulders */}
      <circle cx="6.5" cy="7" r="2.2" />
      <path d="M3 18c0-2.2 1.6-4 3.5-4s3.5 1.8 3.5 4" />
      {/* clipboard */}
      <rect x="12" y="5" width="9" height="14" rx="1.2" />
      <line x1="14.5" y1="8.5"  x2="19" y2="8.5" />
      <line x1="14.5" y1="12"   x2="19" y2="12" />
      <line x1="14.5" y1="15.5" x2="19" y2="15.5" />
      {/* checkmark that strokes in */}
      <path className="tick" d="M13.6 12 L14.8 13.2 L16.2 10.9" fill="none" />
    </Base>
  );
}

/** Static, confident success check. */
export function SuccessCheckIcon() {
  return (
    <Base className="col-icon-done">
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 12.2 L10.7 15.4 L16.5 9.5" />
    </Base>
  );
}

export function iconForStatus(status: string) {
  switch (status) {
    case 'todo':           return <CloudIcon />;
    case 'agent_working':  return <RobotIcon />;
    case 'agent_review':   return <LoupeIcon />;
    case 'human_approval': return <ChecklistIcon />;
    case 'done':           return <SuccessCheckIcon />;
    default:               return null;
  }
}

/** Three-dot "working…" loop used on live task cards. */
export function WorkingDots() {
  return (
    <span className="working-dots" aria-label="working">
      <span /><span /><span />
    </span>
  );
}
