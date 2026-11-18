import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type FocusState, toggleNode } from '@/entities/guide';
import { cn } from '@/shared/lib/cn';
import '../i18n';
import { useClosePage } from '../lib/use-close-page';
import { useDocumentTitle } from '../lib/use-document-title';
import { MANUAL_TABS, type ManualTab } from '../model/manual-search';
import {
  BookIcon,
  CallIcon,
  CloseIcon,
  DocumentIcon,
  HierarchyIcon,
  RepeatIcon,
  SettingIcon,
  TimerIcon,
} from './icons';
import { RulesTab, ScheduleTab, TelegramTab, TransferTab, TroubleshootTab } from './manual/content-tabs';
import { TreeTab } from './manual/TreeTab';
import './guide-panels.css';

const TAB_ICONS: Record<ManualTab, ReactNode> = {
  tree: <HierarchyIcon size={15} strokeWidth={1.8} />,
  rules: <CallIcon />,
  transfer: <RepeatIcon />,
  telegram: <DocumentIcon />,
  schedule: <TimerIcon />,
  troubleshoot: <SettingIcon />,
};

interface OperatorManualPageProps {
  tab: ManualTab;
  onTabChange: (tab: ManualTab) => void;
}

/**
 * "Operator Yo'riqnomasi va Ish Reglamenti" — the legacy viewer modal `modalOperatorManual`, now a page
 * (`/guide/manual?tab=…`) with the same look.
 */
export function OperatorManualPage({ tab, onTabChange }: OperatorManualPageProps) {
  const { t } = useTranslation('guide');
  const close = useClosePage();
  // Kept here so the tree stays as it was when the user comes back to its tab.
  const [treeState, setTreeState] = useState<FocusState>({});
  const onToggle = useCallback((parentId: string, nodeId: string) => {
    setTreeState((s) => toggleNode(s, parentId, nodeId));
  }, []);
  useDocumentTitle(t('manual.title'));

  return (
    <div className="guide-panel-page">
      <section className="guide-panel guide-panel--manual" aria-labelledby="manual-title">
        <header className="guide-panel-header">
          <div className="guide-panel-heading">
            <div className="guide-panel-icon guide-panel-icon--manual">
              <BookIcon />
            </div>
            <div>
              <h1 id="manual-title" className="guide-panel-title guide-panel-title--manual">
                <span>{t('manual.title')}</span>
                <span className="guide-panel-pill">{t('manual.pill')}</span>
              </h1>
              <p className="guide-panel-subtitle">{t('manual.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            className="guide-panel-close"
            title={t('manual.close')}
            aria-label={t('manual.close')}
            onClick={close}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="manual-tabs" role="tablist">
          {MANUAL_TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`manual-tab-${key}`}
              aria-selected={tab === key}
              aria-controls="manual-tabpanel"
              className={cn('manual-tab-btn', tab === key && 'active')}
              onClick={() => onTabChange(key)}
            >
              {TAB_ICONS[key]}
              <span>
                {key === 'tree' ? '🌲 ' : ''}
                {t(`manual.tabs.${key}`)}
              </span>
            </button>
          ))}
        </div>

        <div id="manual-tabpanel" role="tabpanel" aria-labelledby={`manual-tab-${tab}`} className="manual-body">
          {tab === 'tree' && <TreeTab state={treeState} onToggle={onToggle} onReset={() => setTreeState({})} />}
          {tab === 'rules' && <RulesTab />}
          {tab === 'transfer' && <TransferTab />}
          {tab === 'telegram' && <TelegramTab />}
          {tab === 'schedule' && <ScheduleTab />}
          {tab === 'troubleshoot' && <TroubleshootTab />}
        </div>

        <footer className="guide-panel-footer guide-panel-footer--manual">
          <div className="guide-panel-footnote">{t('manual.footer')}</div>
          <button type="button" className="guide-panel-done guide-panel-done--manual" onClick={close}>
            {t('manual.done')}
          </button>
        </footer>
      </section>
    </div>
  );
}
