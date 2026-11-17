import { useEffect, useRef } from 'react';

export type StageMode = 'idle' | 'looking' | 'covering' | 'peeking';
export type StageMood = 'none' | 'success' | 'error';

/**
 * The legacy login "interactive stage": four characters whose eyes follow the pointer,
 * look at the username field, close while the password is typed and peek when it is shown.
 * Pure decoration (aria-hidden).
 */
export function CharactersStage({ mode, mood, caption }: { mode: StageMode; mood: StageMood; caption: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const eyes = Array.from(svg.querySelectorAll<SVGGElement>('.lg-eye'));
    const move = (x: number, y: number, radius = 4.5) => {
      for (const eye of eyes) {
        const rect = eye.getBoundingClientRect();
        const dx = x - (rect.left + rect.width / 2);
        const dy = y - (rect.top + rect.height / 2);
        const angle = Math.atan2(dy, dx);
        const dist = Math.min(radius, Math.hypot(dx, dy) / 20);
        const px = Math.cos(angle) * dist;
        const py = Math.sin(angle) * dist;
        eye.querySelector<SVGElement>('.lg-pupil')?.style.setProperty('transform', `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`);
        eye
          .querySelector<SVGElement>('.lg-pupil-shine')
          ?.style.setProperty('transform', `translate(${(px * 0.7).toFixed(1)}px, ${(py * 0.7).toFixed(1)}px)`);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (modeRef.current !== 'covering') move(e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', onMove);

    const blink = window.setInterval(() => {
      if (modeRef.current === 'covering') return;
      eyes.forEach((el) => el.classList.add('is-blinking'));
      window.setTimeout(() => eyes.forEach((el) => el.classList.remove('is-blinking')), 140);
    }, 3600);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.clearInterval(blink);
    };
  }, []);

  // Look at the focused field when the mode changes.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const target =
      mode === 'looking'
        ? document.getElementById('login-username')
        : mode === 'peeking'
          ? document.getElementById('login-password')
          : null;
    if (mode === 'covering') {
      svg.querySelectorAll<SVGElement>('.lg-pupil, .lg-pupil-shine').forEach((p) => p.style.setProperty('transform', 'translate(0px, 0px)'));
    } else if (target) {
      const r = target.getBoundingClientRect();
      const x = mode === 'peeking' ? r.right - 20 : r.left + 50;
      const event = new PointerEvent('pointermove', { clientX: x, clientY: r.top + r.height / 2 });
      window.dispatchEvent(event);
    }
  }, [mode]);

  return (
    <div className="lg-stage" data-mode={mode} data-mood={mood} aria-hidden="true">
      <svg ref={svgRef} className="lg-stage-svg" viewBox="0 0 360 290" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="lgPurple" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#4f46e5" />
          </linearGradient>
          <linearGradient id="lgPink" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#e11d48" />
          </linearGradient>
          <linearGradient id="lgYellow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="100%" stopColor="#ca8a04" />
          </linearGradient>
          <linearGradient id="lgOrange" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
          <radialGradient id="lgShadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(0,0,0,0.5)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        <ellipse cx="180" cy="275" rx="155" ry="12" fill="url(#lgShadow)" />

        {/* purple */}
        <g className="lg-char lg-char-purple">
          <rect x="65" y="40" width="100" height="230" rx="28" fill="url(#lgPurple)" />
          <path d="M85,45 Q115,41 145,45" stroke="rgba(255,255,255,0.4)" strokeWidth="3" strokeLinecap="round" />
          <g className="lg-eyes-open">
            <Eye cx={100} cy={82} r={8} pr={4.2} />
            <Eye cx={130} cy={82} r={8} pr={4.2} />
          </g>
          <g className="lg-eyes-closed">
            <path d="M92,82 Q100,77 108,82" stroke="#1e1b4b" strokeWidth="2.6" strokeLinecap="round" />
            <path d="M122,82 Q130,77 138,82" stroke="#1e1b4b" strokeWidth="2.6" strokeLinecap="round" />
          </g>
          <path className="lg-mouth" d="M110,102 Q115,108 120,102" stroke="#1e1b4b" strokeWidth="2.2" strokeLinecap="round" />
          <circle className="lg-mouth-o" cx="115" cy="104" r="4" fill="#1e1b4b" />
        </g>

        {/* pink */}
        <g className="lg-char lg-char-pink">
          <rect x="155" y="110" width="70" height="160" rx="16" fill="url(#lgPink)" />
          <path d="M167,115 Q190,112 213,115" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round" />
          <g className="lg-eyes-open">
            <Eye cx={186} cy={142} r={7.5} pr={3.8} />
            <Eye cx={208} cy={142} r={7.5} pr={3.8} />
          </g>
          <g className="lg-eyes-closed">
            <path d="M179,142 Q186,138 193,142" stroke="#881337" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M201,142 Q208,138 215,142" stroke="#881337" strokeWidth="2.2" strokeLinecap="round" />
          </g>
          <path className="lg-mouth" d="M194,158 Q198,162 202,158" stroke="#881337" strokeWidth="2" strokeLinecap="round" />
          <circle className="lg-mouth-o" cx="198" cy="160" r="3" fill="#881337" />
        </g>

        {/* yellow */}
        <g className="lg-char lg-char-yellow">
          <path d="M210,270 L210,185 C210,148 245,148 245,148 C280,148 280,185 280,270 Z" fill="url(#lgYellow)" />
          <path d="M266,192 L312,192 C316,192 318,195 318,198 C318,201 316,204 312,204 L266,204 Z" fill="#b45309" />
          <g className="lg-eyes-open">
            <g className="lg-eye">
              <circle cx="240" cy="182" r="5.5" fill="#0f172a" />
              <circle className="lg-pupil" cx="240" cy="182" r="2.6" fill="#ffffff" />
            </g>
          </g>
          <g className="lg-eyes-closed">
            <path d="M235,182 L245,182" stroke="#713f12" strokeWidth="2.2" strokeLinecap="round" />
          </g>
        </g>

        {/* orange */}
        <g className="lg-char lg-char-orange">
          <path d="M20,270 C20,182 72,172 104,172 C136,172 188,182 188,270 Z" fill="url(#lgOrange)" />
          <path d="M55,188 Q100,178 145,188" stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeLinecap="round" />
          <circle className="lg-blush" cx="112" cy="235" r="7" fill="rgba(239,68,68,0.45)" />
          <circle className="lg-blush" cx="162" cy="235" r="7" fill="rgba(239,68,68,0.45)" />
          <g className="lg-eyes-open">
            <Eye cx={126} cy={222} r={7.5} pr={3.8} />
            <Eye cx={148} cy={222} r={7.5} pr={3.8} />
          </g>
          <g className="lg-eyes-closed">
            <path d="M120,222 Q126,216 132,222" stroke="#7c2d12" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M142,222 Q148,216 154,222" stroke="#7c2d12" strokeWidth="2.4" strokeLinecap="round" />
          </g>
          <path className="lg-mouth" d="M133,238 Q138,245 143,238" stroke="#7c2d12" strokeWidth="2.2" strokeLinecap="round" />
          <circle className="lg-mouth-o" cx="138" cy="240" r="3.5" fill="#7c2d12" />
        </g>
      </svg>
      <div className="lg-stage-caption">
        <i />
        <span>{caption}</span>
      </div>
    </div>
  );
}

function Eye({ cx, cy, r, pr }: { cx: number; cy: number; r: number; pr: number }) {
  return (
    <g className="lg-eye">
      <circle cx={cx} cy={cy} r={r} fill="#ffffff" />
      <circle className="lg-pupil" cx={cx} cy={cy} r={pr} fill="#0f172a" />
      <circle className="lg-pupil-shine" cx={cx - 1.5} cy={cy - 1.5} r={pr * 0.35} fill="#ffffff" />
    </g>
  );
}
