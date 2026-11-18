import type { AuditEntry } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-datetime';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Icon } from '@/shared/ui/icon';
import {
  FieldLabel,
  Pill,
  SettingsButton,
  SettingsCard,
  SettingsCardHeader,
  SettingsInput,
  SettingsSelect,
} from '@/shared/ui/settings-panel';
import { auditActionsQuery, auditQuery } from '../api/admin.queries';

const col = dataTableColumns<AuditEntry>();
const PAGE_SIZE = 50;

function actionTone(action: string) {
  if (action.includes('failed') || action.includes('delete') || action.includes('bad_code')) return 'red' as const;
  if (action.startsWith('auth.login')) return 'green' as const;
  if (action.startsWith('users.') || action.startsWith('groups.')) return 'purple' as const;
  if (action.startsWith('security.') || action.startsWith('settings.')) return 'amber' as const;
  return 'blue' as const;
}

function details(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

export function AuditSettingsPage() {
  const { t } = useTranslation('settings');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const deferredActor = useDeferredValue(actor.trim());
  const deferredTarget = useDeferredValue(target.trim());

  const { data: actions = [] } = useQuery(auditActionsQuery);
  const prefixes = useMemo(() => [...new Set(actions.map((a) => `${a.split('.')[0]}.`))], [actions]);
  const { data, isLoading } = useQuery(
    auditQuery({
      action: action || undefined,
      actor: deferredActor || undefined,
      target: deferredTarget || undefined,
      from: from || undefined,
      to: to || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const columns = useMemo<DataTableColumn<AuditEntry>[]>(
    () => [
      col.accessor('at', {
        header: () => t('audit.colTime'),
        cell: ({ getValue }) => <span className="whitespace-nowrap">{formatDateTime(getValue())}</span>,
      }),
      col.accessor('actorLabel', {
        header: () => t('audit.colActor'),
        cell: ({ getValue }) => <span className="font-semibold text-foreground">{getValue()}</span>,
      }),
      col.accessor('action', {
        header: () => t('audit.colAction'),
        cell: ({ getValue }) => <Pill tone={actionTone(getValue())}>{getValue()}</Pill>,
      }),
      col.accessor('target', { header: () => t('audit.colTarget'), cell: ({ getValue }) => getValue() ?? '—' }),
      col.accessor('ip', {
        header: () => t('audit.colIp'),
        cell: ({ getValue }) => <span className="font-mono text-[11px] text-info">{getValue() ?? '—'}</span>,
      }),
      col.accessor('details', {
        header: () => t('audit.colDetails'),
        cell: ({ getValue }) => (
          <span
            className="block max-w-[320px] truncate font-mono text-[11px] text-mute"
            title={details(getValue())}
          >
            {details(getValue())}
          </span>
        ),
      }),
    ],
    [t],
  );

  const filter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<Icon name="document-text" className="size-5" />}
        title={t('audit.title')}
        description={t('audit.description')}
      />

      <div className="mb-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_0.9fr_0.9fr_auto] lg:items-end">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="audit-action">{t('audit.action')}</FieldLabel>
          <SettingsSelect id="audit-action" value={action} onChange={(e) => filter(setAction)(e.target.value)}>
            <option value="">{t('audit.allActions')}</option>
            {prefixes.map((p) => (
              <option key={p} value={p}>
                {p}*
              </option>
            ))}
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </SettingsSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="audit-actor">{t('audit.actor')}</FieldLabel>
          <SettingsInput id="audit-actor" value={actor} onChange={(e) => filter(setActor)(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="audit-target">{t('audit.target')}</FieldLabel>
          <SettingsInput
            id="audit-target"
            placeholder="user:12"
            value={target}
            onChange={(e) => filter(setTarget)(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="audit-from">{t('audit.from')}</FieldLabel>
          <SettingsInput
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => filter(setFrom)(e.target.value)}
            className=""
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="audit-to">{t('audit.to')}</FieldLabel>
          <SettingsInput
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => filter(setTo)(e.target.value)}
            className=""
          />
        </div>
        <SettingsButton
          tone="ghost"
          onClick={() => {
            setAction('');
            setActor('');
            setTarget('');
            setFrom('');
            setTo('');
            setPage(1);
          }}
        >
          {t('audit.reset')}
        </SettingsButton>
      </div>

      <DataTable
        columns={columns}
        data={data?.items}
        loading={isLoading}
        getRowId={(e) => String(e.id)}
        empty={t('audit.empty')}
      />

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-mute">
        <span>{t('audit.total', { count: data?.total ?? 0 })}</span>
        <div className="flex items-center gap-2">
          <SettingsButton size="sm" tone="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('audit.prev')}
          </SettingsButton>
          <span>{t('audit.page', { page, pages })}</span>
          <SettingsButton size="sm" tone="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('audit.next')}
          </SettingsButton>
        </div>
      </div>
    </SettingsCard>
  );
}
