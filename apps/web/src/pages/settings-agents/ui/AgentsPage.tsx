import type { AgentUpdateLog } from '@cc/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  agentDevicesQuery,
  agentKeys,
  agentReleasesQuery,
  agentStatusQuery,
  agentUpdateLogsQuery,
  useAgentsLive,
} from '@/entities/agent';
import { CreateAgentDeviceForm } from '@/features/agents/create-device';
import { PublishReleaseForm } from '@/features/agents/publish-release';
import { RevokeAgentDeviceButton } from '@/features/agents/revoke-device';
import { cn } from '@/shared/lib/cn';
import { tashkentDateTime } from '@/shared/lib/tashkent-time';
import { Icon } from '@/shared/ui/icon';

const card = 'rounded-xl border border-white/[0.08] bg-slate-800/50 p-4';
const th =
  '[&>th]:bg-sidebar/80 [&>th]:px-3.5 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-semibold [&>th]:text-slate-400';
const tr = 'border-b border-white/5 [&>td]:px-3.5 [&>td]:py-2.5';

const STEP: Record<AgentUpdateLog['step'], { icon: string; color: string }> = {
  DOWNLOADING: { icon: '📥', color: 'text-sky-400' },
  DOWNLOADED: { icon: '📦', color: 'text-violet-400' },
  INSTALLING: { icon: '🔄', color: 'text-amber-400' },
  SUCCESS: { icon: '🎉', color: 'text-emerald-400' },
  ERROR: { icon: '❌', color: 'text-red-400' },
  INFO: { icon: 'ℹ️', color: 'text-slate-400' },
};

function VersionPill({ v }: { v: string | null }) {
  if (!v) return <span className="text-slate-500">—</span>;
  return (
    <span className="rounded-xl border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-[11px] font-bold text-blue-400">
      v{v}
    </span>
  );
}

function OnlineDot({ online, children }: { online: boolean; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', online ? 'text-emerald-400' : 'text-slate-500')}>
      <span
        className={cn('size-2 rounded-full', online ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-slate-500')}
      />
      {children}
    </span>
  );
}

/** 3CX desktop agent admin: official version / OTA release, device keys, live status and update log. */
export function AgentsPage() {
  const { t } = useTranslation('agentsPage');
  const queryClient = useQueryClient();
  useAgentsLive();
  const devices = useQuery(agentDevicesQuery);
  const status = useQuery(agentStatusQuery);
  const releases = useQuery(agentReleasesQuery);
  const logs = useQuery(agentUpdateLogsQuery);
  const latest = status.data?.latestVersion ?? null;
  const release = releases.data?.items[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-blue-500/35 bg-sidebar px-6 py-[18px]">
        <h2 className="text-lg font-bold text-white">⚙️ {t('title')}</h2>
        <p className="mt-1 text-xs text-slate-400">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={card}>
          <h4 className="mb-3 text-sm font-semibold text-blue-300">📦 {t('official')}</h4>
          <div className="flex flex-col gap-2 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              {t('current')}
              <span className="rounded-[20px] border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-[3px] text-[13px] font-bold text-emerald-500">
                v{latest ?? '—'}
              </span>
            </div>
            <div>
              {t('url')}{' '}
              <code className="rounded bg-black/30 px-1.5 py-0.5 text-blue-400">
                {release?.updateUrl ?? '/downloads/agent.exe'}
              </code>
            </div>
            {release?.releaseNotes && <div className="text-slate-400">{release.releaseNotes}</div>}
            <div>
              {t('compat')}{' '}
              <span className={devices.data?.compatMode ? 'text-amber-400' : 'text-emerald-400'}>
                {devices.data?.compatMode ? t('compatOn') : t('compatOff')}
              </span>
            </div>
          </div>
        </div>
        <div className={card}>
          <h4 className="mb-3 text-sm font-semibold text-violet-400">🚀 {t('publish')}</h4>
          <PublishReleaseForm />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-slate-800/40">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <h4 className="text-sm font-semibold text-white">🔑 {t('devices')}</h4>
          <CreateAgentDeviceForm />
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className={th}>
              <th>{t('col.device')}</th>
              <th>Exten</th>
              <th>{t('col.key')}</th>
              <th>{t('col.host')}</th>
              <th>{t('col.version')}</th>
              <th>{t('col.lastSeen')}</th>
              <th>{t('col.state')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(devices.data?.items ?? []).map((d) => (
              <tr key={d.id} className={cn(tr, d.revokedAt && 'opacity-50')}>
                <td className="font-bold text-white">{d.name}</td>
                <td>{d.extension}</td>
                <td className="font-mono text-slate-400">{d.keyPrefix}…</td>
                <td className="text-slate-400">{d.hostname ?? '—'}</td>
                <td>
                  <VersionPill v={d.appVersion} />
                </td>
                <td className="text-slate-400">{d.lastSeenAt ? tashkentDateTime(d.lastSeenAt).slice(0, 16) : '—'}</td>
                <td>
                  {d.revokedAt ? (
                    <span className="text-red-400">{t('revoked', { by: d.revokedBy ?? '' })}</span>
                  ) : (
                    <OnlineDot online={d.online}>{d.online ? t('active') : t('off')}</OnlineDot>
                  )}
                </td>
                <td className="text-right">{!d.revokedAt && <RevokeAgentDeviceButton id={d.id} name={d.name} />}</td>
              </tr>
            ))}
            {devices.data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-500">
                  {t('noDevices')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-sidebar/70 px-4 py-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <h4 className="text-[13px] font-semibold text-sky-400">📡 {t('otaTitle')}</h4>
          <span className="text-[11px] text-emerald-500">● {t('otaLive')}</span>
        </div>
        <div className="flex max-h-[140px] flex-col gap-1 overflow-y-auto rounded-lg border border-white/5 bg-black/40 p-2.5 font-mono text-[11px]">
          {(logs.data?.items ?? []).length === 0 ? (
            <span className="text-slate-500">{t('otaEmpty')}</span>
          ) : (
            [...(logs.data?.items ?? [])].reverse().map((l) => (
              <div
                key={l.id}
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1',
                  l.step === 'SUCCESS' ? 'bg-emerald-500/15' : l.step === 'ERROR' ? 'bg-red-500/15' : 'bg-white/[0.03]',
                )}
              >
                <span className="min-w-[60px] text-slate-500">[{tashkentDateTime(l.at).slice(11)}]</span>
                <span>{STEP[l.step].icon}</span>
                <span className="font-bold text-white">{l.extension}:</span>
                <span className={STEP[l.step].color}>{l.message || l.step}</span>
                {l.targetVersion && <span className="text-slate-500">→ v{l.targetVersion}</span>}
                <span className="ml-auto text-[10px] text-slate-500">[{l.hostname ?? '—'}]</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-slate-800/40">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <h4 className="text-sm font-semibold text-white">👥 {t('statusTitle')}</h4>
          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ queryKey: agentKeys.all })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.08] px-3 py-1.5 text-xs text-white hover:bg-primary"
          >
            <Icon name="refresh" className="size-3.5" /> {t('refresh')}
          </button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className={th}>
              <th>Exten / IP</th>
              <th>{t('col.auth')}</th>
              <th>Desktop Agent</th>
              <th>{t('col.host')}</th>
              <th>{t('col.version')}</th>
              <th>{t('col.state')}</th>
            </tr>
          </thead>
          <tbody>
            {(status.data?.items ?? []).map((s) => (
              <tr key={s.extension} className={tr}>
                <td>
                  <span className="font-bold text-white">{s.extension}</span>{' '}
                  <span className="text-[11px] text-slate-500">({s.ip ?? '—'})</span>
                </td>
                <td className={s.authMode === 'legacy' ? 'text-amber-400' : 'text-slate-300'}>
                  {s.authMode === 'key' ? (s.deviceName ?? t('key')) : t('legacy')}
                </td>
                <td>
                  <OnlineDot online={s.online}>{s.online ? t('active') : t('off')}</OnlineDot>
                </td>
                <td className="text-slate-400">{s.hostname ?? '—'}</td>
                <td>
                  <VersionPill v={s.appVersion} />
                </td>
                <td>
                  {!s.online ? (
                    <span className="text-slate-500">⚪ {t('offline')}</span>
                  ) : s.isLatest ? (
                    <span className="inline-flex items-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                      <Icon name="tick-circle" className="size-3" /> {t('latest')}
                    </span>
                  ) : (
                    <span className="animate-pulse rounded-xl border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-400">
                      ⚠️ {t('updating')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {status.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  {t('noAgents')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
