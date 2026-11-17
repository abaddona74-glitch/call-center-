import type { CallScope } from '@cc/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { businessToday, operatorStatsQuery, type RangePresetId, rangePresets } from '@/entities/call';
import { cn } from '@/shared/lib/cn';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Icon } from '@/shared/ui/icon';
import { Segmented } from '@/shared/ui/segmented';
import { downloadExcel } from '../api/download';
import '../i18n';

const PRESETS: RangePresetId[] = ['today', 'week', 'month', 'prevMonth'];
const PRESET_LABELS: Record<string, Record<RangePresetId, string>> = {
  uz: { today: 'Bugun', yesterday: 'Kecha', week: '7 kun', month: 'Bu oy', prevMonth: "O'tgan oy" },
  ru: { today: 'Сегодня', yesterday: 'Вчера', week: '7 дней', month: 'Этот месяц', prevMonth: 'Прошлый месяц' },
};

/** Legacy "Excel Export" button + modal (date range → operator group → language). */
export function ExportExcelButton({ from, to, scope }: { from: string; to: string; scope: CallScope }) {
  const { t, i18n } = useTranslation('exportExcel');
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState({ from, to });
  const [group, setGroup] = useState('all');
  const [lang, setLang] = useState<'uz' | 'ru'>(i18n.language === 'ru' ? 'ru' : 'uz');
  const today = businessToday();
  const presets = rangePresets(today);
  // operator groups (id + extension range) as configured on the server
  const groups = useQuery({
    ...operatorStatsQuery({ from: today, to: today, scope: 'working' }),
    enabled: open,
    select: (d) => d.groups,
  });
  const download = useMutation({
    mutationFn: () => downloadExcel({ ...range, group, lang, scope }),
    onSuccess: () => setOpen(false),
    onError: () => toast.error(t('failed')),
  });
  const valid = range.from && range.to && range.from <= range.to;
  const labels = PRESET_LABELS[i18n.language] ?? PRESET_LABELS.uz;

  const options = [
    { id: 'all', title: t('options.all.title'), badge: t('options.all.badge'), desc: t('options.all.desc') },
    ...(groups.data ?? []).map((g) => ({
      id: g.id,
      title: t(`options.${g.id}.title`, { defaultValue: g.id }),
      badge: g.id === 'secondary' ? `${g.from}+` : `${g.from}-${g.to}`,
      desc: t(`options.${g.id}.desc`, { defaultValue: '' }),
    })),
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRange({ from, to });
          setOpen(true);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-chart-2 to-chart-2/80 px-3.5 text-xs font-semibold text-white shadow-[0_2px_8px_rgba(16,185,129,0.3)] transition-all hover:brightness-110"
      >
        <Icon name="export" className="size-[15px]" /> {t('button')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-white/8 bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="export" className="size-5 text-success" /> {t('title')}
            </DialogTitle>
            <DialogDescription>{t('subtitle')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-[11px] font-bold tracking-[0.4px] text-muted-foreground uppercase">
                {t('quick')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setRange(presets[id])}
                    className={cn(
                      'rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-chart-4',
                      range.from === presets[id].from &&
                        range.to === presets[id].to &&
                        'border-chart-4/60 bg-chart-4/15 text-chart-4',
                    )}
                  >
                    {labels[id]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['from', 'to'] as const).map((k) => (
                <label
                  key={k}
                  className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground uppercase"
                >
                  {t(k)}
                  <input
                    type="date"
                    value={range[k]}
                    max={today}
                    onChange={(e) => setRange((r) => ({ ...r, [k]: e.target.value }))}
                    className="h-9 rounded-lg border border-white/8 bg-sidebar/75 px-2 text-sm text-foreground [color-scheme:dark] outline-none focus:border-primary"
                  />
                </label>
              ))}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-bold tracking-[0.4px] text-muted-foreground uppercase">
                {t('group')}
              </div>
              <div className="flex flex-col gap-2" role="radiogroup">
                {options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={group === o.id}
                    onClick={() => setGroup(o.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-2.5 text-left transition-all hover:border-chart-4/40',
                      group === o.id && 'border-chart-4/60 bg-chart-4/10',
                    )}
                  >
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{o.title}</div>
                      {o.desc && <div className="text-xs text-muted-foreground">{o.desc}</div>}
                    </div>
                    <span className="rounded-full bg-chart-4/15 px-2.5 py-0.5 text-[11px] font-semibold text-chart-4">
                      {o.badge}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-[0.4px] text-muted-foreground uppercase">
                {t('lang')}
              </span>
              <Segmented
                value={lang}
                onChange={setLang}
                options={[
                  { value: 'uz', label: "O'zbekcha" },
                  { value: 'ru', label: 'Русский' },
                ]}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 rounded-lg border border-white/10 px-4 text-sm text-muted-foreground hover:text-foreground"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={!valid || download.isPending}
                onClick={() => download.mutate()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-br from-chart-2 to-chart-2/80 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                <Icon name="import" className="size-4" /> {download.isPending ? t('downloading') : t('download')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
