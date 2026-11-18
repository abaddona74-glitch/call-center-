import { useTranslation } from 'react-i18next';
import '../i18n';
import { PBX_HOST, SOFTPHONE_MSI_URL } from '../config/content';
import { useClosePage } from '../lib/use-close-page';
import { useDocumentTitle } from '../lib/use-document-title';
import { CloseIcon, PhoneIcon } from './icons';
import './guide-panels.css';

/**
 * "3CX Softphone v6 — Sozlash Yo'riqnomasi" — the legacy viewer modal `modal3cxConfigGuide`, now a page.
 * The softphone is how operators take calls, so the guide stays; its step 3 (install the 3CX Desktop Agent)
 * is dropped because the agent is removed (DECISIONS.md). The parameter texts are Uzbek, as in legacy.
 */
export function SoftphoneGuidePage() {
  const { t } = useTranslation('guide');
  const close = useClosePage();
  useDocumentTitle(t('softphone.title'));

  return (
    <div className="guide-panel-page">
      <section className="guide-panel guide-panel--softphone" aria-labelledby="softphone-title">
        <header className="guide-panel-header">
          <div className="guide-panel-heading guide-panel-heading--tight">
            <div className="guide-panel-icon guide-panel-icon--softphone">
              <PhoneIcon />
            </div>
            <div>
              <h1 id="softphone-title" className="guide-panel-title">
                {t('softphone.title')}
              </h1>
              <p className="guide-panel-subtitle">{t('softphone.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            className="guide-panel-close guide-panel-close--sm"
            title={t('softphone.close')}
            aria-label={t('softphone.close')}
            onClick={close}
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="softphone-body">
          <div className="softphone-params">
            <h4 className="softphone-params-title">⚙️ 3CX Phone (v6) ga kiritiladigan parametrlar:</h4>
            <table className="softphone-table">
              <tbody>
                <tr>
                  <td>Account Name:</td>
                  <td>Operator Raqami (masalan 114 yoki 200)</td>
                </tr>
                <tr>
                  <td>Caller ID:</td>
                  <td>Operator ID (masalan 114)</td>
                </tr>
                <tr>
                  <td>Extension:</td>
                  <td>Operator ID (masalan 114)</td>
                </tr>
                <tr>
                  <td>ID:</td>
                  <td>Operator ID (masalan 114)</td>
                </tr>
                <tr>
                  <td>Password:</td>
                  <td className="softphone-secret">Asterisk SIP paroli</td>
                </tr>
                <tr>
                  <td>PBX / Server IP:</td>
                  <td className="softphone-host">{PBX_HOST}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="softphone-step">
            <strong className="text-ink">1-qadam:</strong>{' '}
            <a href={SOFTPHONE_MSI_URL} download className="softphone-link">
              3CXPhone6.msi
            </a>{' '}
            faylini yuklab oling va kompyuterga o'rnating.
          </div>
          <div className="softphone-step softphone-step--last">
            <strong className="text-ink">2-qadam:</strong> Dasturni ochib, yuqoridagi jadval asosida operatoringiz
            hisobini (Account) yarating va <b>OK</b> bosing. "On Hook" (yashil) holatiga o'tadi.
          </div>
        </div>

        <footer className="guide-panel-footer guide-panel-footer--softphone">
          <button type="button" className="guide-panel-done" onClick={close}>
            {t('softphone.done')}
          </button>
        </footer>
      </section>
    </div>
  );
}
