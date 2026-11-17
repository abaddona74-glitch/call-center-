import { Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui/icon';
import { IconKey, IconPeople, IconUser } from '@/shared/ui/inline-icons';
import '../i18n';

type Tab = {
  to: '/settings/users' | '/settings/groups' | '/settings/sessions' | '/settings/security' | '/settings/audit';
  key: string;
  icon: ReactNode;
};

/** Legacy order: security first, then users, sessions (groups and audit are new). */
const TABS: Tab[] = [
  { to: '/settings/security', key: 'security', icon: <Icon name="timer" /> },
  { to: '/settings/users', key: 'users', icon: <IconUser size={16} /> },
  { to: '/settings/groups', key: 'groups', icon: <IconPeople size={16} /> },
  { to: '/settings/sessions', key: 'sessions', icon: <IconKey size={16} /> },
  { to: '/settings/audit', key: 'audit', icon: <Icon name="document-text" /> },
];

/** Legacy "Tizim Sozlamalari" card: header, pill tab bar, content pane — as a page with sub-routes. */
export function SettingsLayout() {
  const { t } = useTranslation('settings');
  return (
    <div className="mx-auto flex max-w-[1060px] flex-col overflow-hidden rounded-[18px] border border-white/12 bg-[linear-gradient(160deg,#1e293b_0%,#0f172a_100%)] shadow-[0_25px_60px_rgba(0,0,0,0.45),0_0_1px_rgba(255,255,255,0.2)]">
      <div className="flex items-center justify-between border-b border-white/8 px-[22px] pt-[18px] pb-3.5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.15)] text-[#60a5fa]">
            <Icon name="setting-4" className="size-5" />
          </span>
          <div>
            <h2 className="m-0 text-[17px] font-bold text-[#f8fafc]">{t('title')}</h2>
            <p className="mt-0.5 text-xs text-[#94a3b8]">{t('subtitle')}</p>
          </div>
        </div>
      </div>

      <nav className="flex gap-2 overflow-x-auto border-b border-white/6 bg-[rgba(15,23,42,0.6)] px-4 py-2 [scrollbar-width:none]">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="inline-flex items-center gap-2 rounded-[10px] border border-transparent px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap text-[#94a3b8] transition-all hover:bg-white/[0.04] hover:text-[#f1f5f9]"
            activeProps={{
              className:
                '!border-[rgba(59,130,246,0.4)] !bg-[rgba(59,130,246,0.2)] !text-[#93c5fd] shadow-[0_2px_8px_rgba(59,130,246,0.15)]',
            }}
          >
            {tab.icon}
            <span>{t(`tabs.${tab.key}`)}</span>
          </Link>
        ))}
      </nav>

      <div className="animate-in px-[22px] py-[18px] fade-in-0 slide-in-from-bottom-1 duration-200">
        <Outlet />
      </div>
    </div>
  );
}
