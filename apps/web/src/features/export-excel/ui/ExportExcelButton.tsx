import type { CallScope } from '@cc/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { businessToday, calendarLabels, operatorStatsQuery, type RangePresetId, rangePresets } from '@/entities/call';
import { cn } from '@/shared/lib/cn';
import { DateRangeModal } from '@/shared/ui/date-range-modal';
import { Icon } from '@/shared/ui/icon';
import { Modal, ModalButton, ModalHeader } from '@/shared/ui/modal';
import { toDmy } from '@/shared/ui/range-calendar';
import { downloadExcel } from '../api/download';
import '../i18n';

const PRESETS: RangePresetId[] = ['today', 'week', 'month', 'prevMonth'];
const GROUP_ICON: Record<string, string> = { all: 'global', main: 'user', secondary: 'user' };
const GROUP_TONE: Record<string, string> = {
  all: 'bg-chart-2/15 border-chart-2/40 text-success',
  main: 'bg-chart-6/15 border-chart-6/40 text-chart-6',
  secondary: 'bg-chart-3/15 border-chart-3/40 text-outbound',
};

/** Legacy export flow: "Hisobotni Export Qilish" (period) → "Qaysi hisobotni yuklab olmoqchisiz?" (language + group). */
export function ExportExcelButton({ from, to, scope }: { from: string; to: string; scope: CallScope }) {
  const { t, i18n } = useTranslation('exportExcel');
  const [step, setStep] = useState<'closed' | 'range' | 'choice'>('closed');
  const [range, setRange] = useState({ from, to });
  const [lang, setLang] = useState<'uz' | 'ru'>(i18n.language === 'ru' ? 'ru' : 'uz');
  const today = businessToday();
  const presets = rangePresets(today);
  const cal = calendarLabels(i18n.language);
  const groups = useQuery({
    ...operatorStatsQuery({ from: today, to: today, scope: 'working' }),
    enabled: step !== 'closed',
    select: (d) => d.groups,
  });
  const download = useMutation({
    mutationFn: (group: string) => downloadExcel({ ...range, group, lang, scope }),
    onSuccess: () => setStep('closed'),
    onError: () => toast.error(t('failed')),
  });

  const groupList = groups.data ?? [];
  const options = [
    {
      id: 'all',
      title: t('options.all.title'),
      badge: t('options.all.badge'),
      desc: t('options.all.desc', {
        groups: groupList.map((g) => (g.id === 'secondary' ? `${g.from}+` : `${g.from}–${g.to}`)).join(' va '),
      }),
    },
    ...groupList.map((g) => ({
      id: g.id,
      title: t(`options.${g.id}.title`, { defaultValue: g.id }),
      badge: g.id === 'secondary' ? `${g.from}+` : `${g.from}–${g.to}`,
      desc: t([`options.${g.id}.desc`, 'options.other.desc'], { from: g.from, to: g.to }),
    })),
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRange({ from, to });
          setStep('range');
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-br from-chart-2 to-chart-2/75 px-4 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.3)] transition-all hover:brightness-110"
      >
        <Icon name="export" className="size-4" /> {t('button')}
      </button>

      <DateRangeModal
        open={step === 'range'}
        onOpenChange={(o) => !o && setStep('closed')}
        initial={range}
        today={today}
        max={today}
        title={t('title')}
        subtitle={t('subtitle')}
        icon={<Icon name="export" className="size-5 text-white" />}
        presets={PRESETS.map((id) => ({ label: t(`presets.${id}`), ...presets[id] }))}
        labels={{
          quick: t('quick'),
          from: t('from'),
          to: t('to'),
          summary: (r, days) => t('summaryText', { days, from: toDmy(r.from), to: toDmy(r.to) }),
          monthNames: cal.months,
          weekdayNames: cal.weekdays,
        }}
      >
        {(r, valid) => (
          <>
            <ModalButton onClick={() => setStep('closed')}>{t('cancel')}</ModalButton>
            <ModalButton
              tone="green"
              disabled={!valid}
              onClick={() => {
                setRange(r);
                setStep('choice');
              }}
            >
              <Icon name="export" className="size-4" /> {t('next')}
            </ModalButton>
          </>
        )}
      </DateRangeModal>

      <Modal open={step === 'choice'} onOpenChange={(o) => !o && setStep('closed')} glow="indigo">
        <ModalHeader
          icon={<Icon name="document-text" className="size-5 text-white" />}
          title={t('choiceTitle')}
          subtitle={t('choiceSubtitle', { from: toDmy(range.from), to: toDmy(range.to) })}
        />
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
            <Icon name="global" className="size-6 shrink-0 text-chart-4" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-white">{t('lang')}</div>
              <div className="text-[11px] text-foreground/80">{t(`langHint.${lang}`)}</div>
            </div>
            <div className="flex gap-1 rounded-[10px] border border-white/10 bg-black/25 p-1" role="radiogroup">
              {(['uz', 'ru'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={lang === l}
                  onClick={() => setLang(l)}
                  className={cn(
                    'flex min-w-[84px] flex-col items-center rounded-lg px-3 py-1.5 text-xs font-bold text-foreground/85 transition-all',
                    lang === l &&
                      'bg-gradient-to-br from-chart-6 to-chart-6/80 text-white shadow-[0_2px_8px_rgba(59,130,246,0.35)]',
                  )}
                >
                  <span aria-hidden="true">{l === 'uz' ? '🇺🇿' : '🇷🇺'}</span>
                  {l === 'uz' ? "O'zbekcha" : 'Русский'}
                </button>
              ))}
            </div>
          </div>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={download.isPending}
              onClick={() => download.mutate(o.id)}
              className="group flex items-center gap-3.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-left transition-all hover:border-chart-4/45 hover:bg-white/[0.06] disabled:opacity-60"
            >
              <span
                className={cn(
                  'flex size-11 shrink-0 items-center justify-center rounded-[10px] border',
                  GROUP_TONE[o.id] ?? GROUP_TONE.main,
                )}
              >
                <Icon name={GROUP_ICON[o.id] ?? 'user'} className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[15px] font-bold text-white">
                  {o.title}
                  <span
                    className={cn(
                      'rounded-md border px-1.5 py-px text-[10px] font-bold',
                      GROUP_TONE[o.id] ?? GROUP_TONE.main,
                    )}
                  >
                    {o.badge}
                  </span>
                </span>
                <span className="block text-xs text-foreground/80">{o.desc}</span>
              </span>
              {download.isPending && download.variables === o.id ? (
                <span className="text-xs text-muted-foreground">{t('downloading')}</span>
              ) : (
                <Icon
                  name="arrow-right"
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              )}
            </button>
          ))}
          <div className="-mx-6 mt-1 flex justify-between border-t border-white/8 px-6 pt-4">
            <ModalButton onClick={() => setStep('range')}>
              <Icon name="arrow-left" className="size-3.5" /> {t('back')}
            </ModalButton>
            <ModalButton onClick={() => setStep('closed')}>{t('cancel')}</ModalButton>
          </div>
        </div>
      </Modal>
    </>
  );
}
