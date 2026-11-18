import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { toolFileUrl } from '@/entities/tool';
import { copyText } from '../lib/clipboard';
import { KEYBOARD_PACKAGE, KEY_COMBOS, QUICK_CHARS, insertAt } from '../model/keys';
import '../i18n';
import './uzb-keyboard.css';

const RICH = { b: <strong />, code: <code /> };
const STEPS = [1, 2, 3, 4] as const;

function InfoCircle({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/**
 * New Uzbek alphabet (2026) keyboard: installer download, key combinations with copy, a test area with
 * quick insert, and the install guide (legacy tools/uzb2026.html). Fills its container (a page or a modal).
 */
export function UzbKeyboardGuide() {
  const { t } = useTranslation('uzbKeyboardGuide');
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const areaId = useId();
  const [text, setText] = useState('');

  // Put the caret after the inserted character once React has rendered the new value.
  useLayoutEffect(() => {
    const ta = areaRef.current;
    const caret = caretRef.current;
    if (!ta || caret === null) return;
    caretRef.current = null;
    ta.focus();
    ta.setSelectionRange(caret, caret);
  }, [text]);

  const insertChar = (ch: string) => {
    const ta = areaRef.current;
    const next = insertAt(text, ta?.selectionStart, ta?.selectionEnd, ch);
    caretRef.current = next.caret;
    setText(next.text);
  };

  const copyChar = async (ch: string) => {
    if (await copyText(ch, rootRef.current)) toast.success(t('toast.char', { ch }));
    else insertChar(ch); // legacy: no clipboard → put the character into the test area instead
  };

  const copyAll = async () => {
    if (!text.trim()) {
      toast.warning(t('toast.empty'));
      return;
    }
    if (await copyText(text, rootRef.current)) toast.success(t('toast.all'));
    else toast.error(t('toast.failed'));
  };

  return (
    <div ref={rootRef} className="uk-root">
      <header className="uk-header">
        <div className="uk-header-title">
          <div className="uk-header-icon">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
              <line x1="6" y1="8" x2="6" y2="8.01" />
              <line x1="10" y1="8" x2="10" y2="8.01" />
              <line x1="14" y1="8" x2="14" y2="8.01" />
              <line x1="18" y1="8" x2="18" y2="8.01" />
              <line x1="6" y1="12" x2="6" y2="12.01" />
              <line x1="10" y1="12" x2="10" y2="12.01" />
              <line x1="14" y1="12" x2="14" y2="12.01" />
              <line x1="18" y1="12" x2="18" y2="12.01" />
              <line x1="7" y1="16" x2="17" y2="16" />
            </svg>
          </div>
          <div>
            <h2>{t('title')}</h2>
            <p>{t('subtitle')}</p>
          </div>
        </div>

        <a href={toolFileUrl(KEYBOARD_PACKAGE)} download={KEYBOARD_PACKAGE} className="uk-download">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2V14M12 14L8.5 10.5M12 14L15.5 10.5" />
            <path d="M2 13V15C2 18.87 3.13 22 7 22H17C20.87 22 22 18.87 22 15V13" />
          </svg>
          <span>{t('download')}</span>
        </a>
      </header>

      <div className="uk-alert" role="note">
        <InfoCircle size={22} />
        <p className="uk-alert-text">
          <Trans t={t} i18nKey="rule" components={RICH} />
        </p>
      </div>

      <div className="uk-grid">
        {/* Key combinations */}
        <section className="uk-card">
          <div className="uk-card-head">
            <h3 className="uk-card-title">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--info)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                <line x1="7" y1="16" x2="17" y2="16" />
              </svg>
              <span>{t('cheat.title')}</span>
            </h3>
            <span className="uk-card-badge">{t('cheat.badge')}</span>
          </div>

          <ul className="uk-keys">
            {KEY_COMBOS.map((combo) => (
              <li key={combo.char} className="uk-key-item">
                <span className="uk-combo">
                  <kbd className="uk-kbd">{t('cheat.rightAlt')}</kbd>
                  <span>+</span>
                  {combo.shift && (
                    <>
                      <kbd className="uk-kbd">{t('cheat.shift')}</kbd>
                      <span>+</span>
                    </>
                  )}
                  <kbd className="uk-kbd">{combo.key}</kbd>
                </span>
                <span className="uk-arrow" aria-hidden="true">
                  →
                </span>
                <button
                  type="button"
                  className="uk-result"
                  title={t('cheat.copyTitle')}
                  aria-label={t('cheat.copyLabel', { ch: combo.char })}
                  onClick={() => void copyChar(combo.char)}
                >
                  {combo.char}
                </button>
              </li>
            ))}
          </ul>

          {/* Live test area */}
          <div className="uk-playground">
            <div className="uk-playground-head">
              <label htmlFor={areaId} className="uk-playground-label">
                {t('playground.label')}
              </label>
              <span className="uk-count" aria-live="polite">
                {t('playground.chars', { n: text.length })}
              </span>
            </div>
            <textarea
              id={areaId}
              ref={areaRef}
              className="uk-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('playground.placeholder')}
              spellCheck={false}
            />
            <div className="uk-playground-actions">
              <div className="uk-quick">
                <span className="uk-quick-label">{t('playground.quick')}</span>
                {QUICK_CHARS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    className="uk-quick-btn"
                    aria-label={t('playground.insertLabel', { ch })}
                    onClick={() => insertChar(ch)}
                  >
                    {ch}
                  </button>
                ))}
              </div>
              <button type="button" className="uk-copy-btn" onClick={() => void copyAll()}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>{t('playground.copy')}</span>
              </button>
            </div>
          </div>
        </section>

        {/* Install guide */}
        <section className="uk-card">
          <div className="uk-card-head">
            <h3 className="uk-card-title">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              <span>{t('guide.title')}</span>
            </h3>
            <span className="uk-card-badge blue">{t('guide.badge')}</span>
          </div>

          <ol className="uk-steps">
            {STEPS.map((n) => (
              <li key={n} className="uk-step">
                <div className="uk-step-num" aria-hidden="true">
                  {n}
                </div>
                <div>
                  <h4>{t(`guide.s${n}Title`)}</h4>
                  <p>
                    <Trans t={t} i18nKey={`guide.s${n}Text`} values={{ file: KEYBOARD_PACKAGE }} components={RICH} />
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="uk-why">
            <div className="uk-why-head">
              <InfoCircle size={16} />
              <strong>{t('why.title')}</strong>
            </div>
            <p>
              <Trans t={t} i18nKey="why.text" components={RICH} />
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
