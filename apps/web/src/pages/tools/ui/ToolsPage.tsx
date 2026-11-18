import { useQuery } from '@tanstack/react-query';
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/entities/session';
import { toolsConfigQuery, uzcryptoDownloadUrl, uzcryptoQuery } from '@/entities/tool';
import { ConverterModal } from '@/features/tools/convert-file';
import { Icon } from '@/shared/ui/icon';
import {
  type Layout,
  type ToolId,
  ZONES,
  type Zone,
  dropBefore,
  loadLayout,
  moveTool,
  saveLayout,
} from '../model/layout';
import {
  BookIcon,
  BoxAddIcon,
  CategoryIcon,
  ConvertIcon,
  DocumentIcon,
  DragHintIcon,
  ExternalIcon,
  KeyboardIcon,
  StarIcon,
  TelegramIcon,
  TreeIcon,
  UserIcon,
} from './icons';
import { type ToolView, ToolModal } from './ToolModal';
import './tools.css';

const EDO_CABINET_URL = 'https://cabinet.ijro.uz/';
// Legacy linked http://; the site redirects to https.
const EHUQUQ_CABINET_URL = 'https://cabinet.e-huquqshunos.uz/';
const IJRO_LETTER_URL = 'https://xat-tayyorlash.vercel.app';
const EDO_WELCOME_URL = 'https://edo.ijro.uz/welcome';
/** Routes of the operator guide (session S9). */
const GUIDE_MANUAL_PATH = '/guide/manual';
const GUIDE_TREE_PATH = '/guide';

type PillTone = 'default' | 'sky' | 'purple' | 'green' | 'red' | 'muted';

interface CardSpec {
  icon: ReactNode;
  iconBg: string;
  pill: { text: string; tone: PillTone; title?: string };
  /** Footer buttons; the one marked `data-default` runs when the card itself is clicked. */
  actions: ReactNode;
}

const newTab = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * "Asboblar" (legacy viewer tools zones, screenshot viewer-01-main-full): three zones of tool cards,
 * dragged between zones, the layout kept in this browser. "Shu yerda ochish" opens a big modal.
 */
export function ToolsPage() {
  const { t } = useTranslation('tools');
  const canUseExtra = usePermission('tools.use');
  const config = useQuery(toolsConfigQuery);
  const uzcrypto = useQuery(uzcryptoQuery);

  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [dragging, setDragging] = useState<ToolId | null>(null);
  const [overZone, setOverZone] = useState<Zone | null>(null);
  const [justMoved, setJustMoved] = useState<ToolId | null>(null);
  const [view, setView] = useState<ToolView | null>(null);
  const [converterOpen, setConverterOpen] = useState(false);
  const recentlyDropped = useRef(false);
  const grids = useRef<Partial<Record<Zone, HTMLDivElement | null>>>({});

  useEffect(() => {
    if (!justMoved) return;
    const timer = setTimeout(() => setJustMoved(null), 600);
    return () => clearTimeout(timer);
  }, [justMoved]);

  // Legacy hid the converter and the Ijro letter generator from the "200" group (now: tools.use).
  const visible = (id: ToolId) => canUseExtra || (id !== 'converter' && id !== 'ijro_letter');

  const telegramUrl = config.data?.telegramFormUrl ?? null;
  const version = uzcrypto.data?.version ?? '2.2.4.24';

  const openHere = (next: ToolView) => () => setView(next);
  const openButton = (href: string, extra?: { tone?: string; label?: string; title?: string }) => (
    <a className="tl-btn primary" data-tone={extra?.tone} href={href} title={extra?.title} {...newTab}>
      <span>{extra?.label ?? t('open')}</span>
      <ExternalIcon />
    </a>
  );
  const hereButton = (onClick: () => void, isDefault = true) => (
    <button type="button" className="tl-btn secondary" data-default={isDefault || undefined} onClick={onClick}>
      <span>{t('openHere')}</span>
    </button>
  );

  const cards: Record<ToolId, CardSpec> = {
    edo_cabinet: {
      icon: <img src="/icons/tools/edo-symbol.svg" alt="" className="is-white size-[26px]" />,
      iconBg: 'linear-gradient(135deg, #0284c7 0%, #1e40af 100%)',
      pill: { text: 'cabinet.ijro.uz', tone: 'sky' },
      // The site forbids being shown inside another page (X-Frame-Options), so only "open".
      actions: <span data-default>{openButton(EDO_CABINET_URL)}</span>,
    },
    ehuquq_cabinet: {
      icon: <img src="/icons/tools/e-huquqshunos-logo.svg" alt="" className="is-white size-[26px]" />,
      iconBg: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)',
      pill: { text: 'cabinet.e-huquqshunos.uz', tone: 'purple' },
      actions: <span data-default>{openButton(EHUQUQ_CABINET_URL)}</span>,
    },
    operator_manual: {
      icon: <BookIcon />,
      iconBg: 'linear-gradient(135deg, #10b981 0%, #0284c7 100%)',
      pill: { text: t('card.operator_manual.pill'), tone: 'green' },
      actions: (
        <a className="tl-btn primary" data-tone="teal" data-default href={GUIDE_MANUAL_PATH}>
          <BookIcon size={14} />
          <span>{t('open')}</span>
        </a>
      ),
    },
    systems_tree: {
      icon: <TreeIcon />,
      iconBg: 'linear-gradient(135deg, #6366f1 0%, #0ea5e9 100%)',
      pill: { text: t('card.systems_tree.pill'), tone: 'sky' },
      actions: (
        <a className="tl-btn primary" data-default href={GUIDE_TREE_PATH}>
          <span>{t('open')}</span>
        </a>
      ),
    },
    managers: {
      icon: <UserIcon />,
      iconBg: 'linear-gradient(135deg, #0284c7 0%, #10b981 100%)',
      pill: { text: t('active'), tone: 'default' },
      actions: (
        <>
          <a className="tl-btn primary" href="/tools/managers" {...newTab}>
            <span>{t('open')}</span>
            <Icon name="export" className="size-3.5" />
          </a>
          {hereButton(openHere({ kind: 'managers' }))}
        </>
      ),
    },
    converter: {
      icon: <ConvertIcon />,
      iconBg: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
      pill: { text: t('active'), tone: 'default' },
      actions: (
        <>
          <button type="button" className="tl-btn primary" onClick={() => setConverterOpen(true)}>
            <span>{t('open')}</span>
            <ExternalIcon />
          </button>
          {hereButton(() => setConverterOpen(true))}
        </>
      ),
    },
    uzcrypto: {
      icon: <img src="/icons/tools/uzcrypto.png" alt="" className="size-[26px] rounded-md object-contain" />,
      iconBg: 'linear-gradient(135deg, #0284c7 0%, #1e3a8a 100%)',
      pill: { text: t('card.uzcrypto.pill', { version }), tone: 'green' },
      actions: (
        <>
          <a
            className="tl-btn primary"
            data-default
            href={uzcryptoDownloadUrl('windows')}
            title={t('card.uzcrypto.downloadTitle')}
            {...newTab}
          >
            <Icon name="import" className="size-3.5" />
            <span>{t('card.uzcrypto.download')}</span>
          </a>
          <a className="tl-btn secondary" href={EDO_WELCOME_URL} title={t('card.uzcrypto.welcomeTitle')} {...newTab}>
            <Icon name="global" className="size-3.5" />
            <span>{t('card.uzcrypto.welcome')}</span>
          </a>
        </>
      ),
    },
    telegram: {
      icon: <TelegramIcon />,
      iconBg: 'linear-gradient(135deg, #0088cc 0%, #00a8ff 100%)',
      pill: telegramUrl
        ? { text: t('active'), tone: 'default' }
        : { text: t('card.telegram.notConfigured'), tone: 'muted', title: t('card.telegram.notConfiguredTitle') },
      // Only a link (the old /telegram-form proxy is not part of the new system).
      actions: telegramUrl ? (
        <span data-default>{openButton(telegramUrl)}</span>
      ) : (
        <span className="tl-btn primary" aria-disabled="true" title={t('card.telegram.notConfiguredTitle')}>
          <span>{t('open')}</span>
          <ExternalIcon />
        </span>
      ),
    },
    ijro_letter: {
      icon: <DocumentIcon />,
      iconBg: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      pill: { text: t('active'), tone: 'default' },
      actions: (
        <>
          {openButton(IJRO_LETTER_URL)}
          {hereButton(openHere({ kind: 'iframe', url: IJRO_LETTER_URL, titleKey: 'card.ijro_letter.title' }))}
        </>
      ),
    },
    uzb2026: {
      icon: <KeyboardIcon />,
      iconBg: 'linear-gradient(135deg, #0284c7 0%, #6366f1 100%)',
      pill: { text: t('active'), tone: 'default' },
      actions: (
        <>
          {openButton('/tools/uzb2026')}
          {hereButton(openHere({ kind: 'uzb2026' }))}
        </>
      ),
    },
  };

  const commitMove = (id: ToolId, zone: Zone, x: number, y: number) => {
    const grid = grids.current[zone];
    const rects = grid
      ? [...grid.querySelectorAll<HTMLElement>('[data-tool-id]')]
          .filter((el) => el.dataset.toolId !== id)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { id: el.dataset.toolId as ToolId, left: r.left, top: r.top, width: r.width, height: r.height };
          })
      : [];
    const next = moveTool(layout, id, zone, dropBefore(rects, x, y));
    setLayout(next);
    saveLayout(next);
    setJustMoved(id);
  };

  /** Legacy: clicking the card (not a button) runs its "open here" or main action. */
  const onCardClick = (e: MouseEvent<HTMLElement>) => {
    if (dragging || recentlyDropped.current) return;
    if ((e.target as HTMLElement).closest('a, button, input, [aria-disabled="true"]')) return;
    const target = e.currentTarget.querySelector<HTMLElement>('[data-default]');
    const clickable = target?.matches('a, button') ? target : target?.querySelector<HTMLElement>('a, button');
    clickable?.click();
  };

  const zoneMeta: Record<Zone, { icon: ReactNode; hint: boolean }> = {
    admin: { icon: <Icon name="unlock" className="size-5 text-chart-4" />, hint: false },
    primary: { icon: <StarIcon className="text-chart-5" />, hint: true },
    secondary: { icon: <CategoryIcon className="text-chart-4" />, hint: true },
  };

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      {ZONES.map((zone) => {
        const ids = layout[zone].filter(visible);
        return (
          <section key={zone} className="tl-panel" aria-labelledby={`tools-zone-${zone}`}>
            <div className="tl-heading">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                {zoneMeta[zone].icon}
                <h2 id={`tools-zone-${zone}`} className="m-0 text-[18px] font-bold">
                  {t(`zone.${zone}.title`)}
                </h2>
                <span className="tl-badge" data-tone={zone}>
                  {t(`zone.${zone}.badge`)}
                </span>
                <span className="tl-count" title={t('count', { n: ids.length })} data-testid={`tools-count-${zone}`}>
                  {ids.length}
                </span>
              </div>
              {zoneMeta[zone].hint && (
                <div className="tl-hint max-sm:hidden">
                  <DragHintIcon />
                  <span>{t('dragHint')}</span>
                </div>
              )}
            </div>

            <div
              ref={(el) => {
                grids.current[zone] = el;
              }}
              className={`tl-grid${overZone === zone ? ' is-over' : ''}`}
              data-zone={zone}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overZone !== zone) setOverZone(zone);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverZone(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOverZone(null);
                if (dragging) commitMove(dragging, zone, e.clientX, e.clientY);
              }}
            >
              {ids.length === 0 && (
                <div className="tl-empty">
                  <div className="mb-2 flex justify-center text-dim">
                    <BoxAddIcon />
                  </div>
                  <div>{t(`empty.${zone}`)}</div>
                  <div className="mt-1 text-[11.5px] text-slate-600">{t(`empty.${zone}Hint`)}</div>
                </div>
              )}
              {ids.map((id) => {
                const card = cards[id];
                return (
                  <article
                    key={id}
                    className={`tl-card${dragging === id ? ' is-dragging' : ''}${justMoved === id ? ' just-moved' : ''}`}
                    data-tool-id={id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', id);
                      setDragging(id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOverZone(null);
                      recentlyDropped.current = true;
                      setTimeout(() => {
                        recentlyDropped.current = false;
                      }, 250);
                    }}
                    onClick={onCardClick}
                  >
                    <div className="tl-icon" style={{ background: card.iconBg }}>
                      {card.icon}
                    </div>
                    <div className="tl-content">
                      <div className="tl-top">
                        <h3 className="tl-title">{t(`card.${id}.title`)}</h3>
                        <span className="tl-pill" data-tone={card.pill.tone} title={card.pill.title}>
                          {card.pill.text}
                        </span>
                      </div>
                      <p className="tl-desc">{t(`card.${id}.desc`)}</p>
                      <div className="tl-footer">{card.actions}</div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      <ToolModal view={view} onClose={() => setView(null)} />
      {canUseExtra && <ConverterModal open={converterOpen} onOpenChange={setConverterOpen} />}
    </div>
  );
}
