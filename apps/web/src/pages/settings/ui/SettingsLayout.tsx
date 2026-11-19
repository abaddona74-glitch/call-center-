import { hasPermission } from '@cc/shared';
import { Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { Icon } from '@/shared/ui/icon';
import { IconKey, IconUser } from '@/shared/ui/inline-icons';
import '../i18n';
import { SETTINGS_TABS } from '../model/tabs';

const ICONS: Record<string, ReactNode> = {
  security: <Icon name="timer" />,
  exclude: <Icon name="document-text" />,
  users: <IconUser size={16} />,
  sessions: <IconKey size={16} />,
  audit: <Icon name="document-text" />,
};

/** Legacy "Tizim Sozlamalari" card: header, pill tab bar, content pane — as a page with sub-routes. */
export function SettingsLayout() {
  const { t } = useTranslation('settings');
  const user = useSessionUser();
  const tabs = SETTINGS_TABS.filter((tab) => hasPermission(user, tab.permission));
  return (
    <div className="mx-auto flex max-w-[1060px] flex-col overflow-hidden rounded-[18px] border border-tint/12 bg-[linear-gradient(160deg,var(--glass-2)_0%,var(--sidebar)_100%)] shadow-[0_25px_60px_color-mix(in_srgb,var(--shadow-color)_45%,transparent),0_0_1px_color-mix(in_srgb,var(--tint)_20%,transparent)]">
      <div className="flex items-center justify-between border-b border-tint/8 px-[22px] pt-[18px] pb-3.5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.15)] text-link">
            <Icon name="setting-4" className="size-5" />
          </span>
          <div>
            <h2 className="m-0 text-[17px] font-bold text-ink">{t('title')}</h2>
            <p className="mt-0.5 text-xs text-mute">{t('subtitle')}</p>
          </div>
        </div>
      </div>

      <nav className="flex gap-2 overflow-x-auto border-b border-tint/6 bg-glass/60 px-4 py-2 [scrollbar-width:none]">
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="inline-flex items-center gap-2 rounded-[10px] border border-transparent px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap text-mute transition-all hover:bg-tint/[0.04] hover:text-ink"
            activeProps={{
              className:
                '!border-[rgba(59,130,246,0.4)] !bg-[rgba(59,130,246,0.2)] !text-link-soft shadow-[0_2px_8px_rgba(59,130,246,0.15)]',
            }}
          >
            {ICONS[tab.key]}
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
