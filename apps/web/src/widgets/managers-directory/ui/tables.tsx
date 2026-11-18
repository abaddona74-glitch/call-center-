import type { ManagersExatEntry, ManagersMinistryEntry, ManagersRegionEntry, ManagersTashkentEntry } from '@cc/shared';
import { Trans, useTranslation } from 'react-i18next';
import { CheckIcon, EmptyState, EnvelopeIcon, Highlight, InfoIcon, PhonePill } from './parts';

interface TableProps<T> {
  items: T[];
  query: string;
  onCopy: (display: string) => void;
}

export function TashkentTable({
  items,
  query,
  onCopy,
  contracts,
}: TableProps<ManagersTashkentEntry> & { contracts: ManagersTashkentEntry | undefined }) {
  const { t } = useTranslation('managersDirectory');
  if (items.length === 0) return <EmptyState />;
  return (
    <>
      {contracts && (
        <div className="md-contracts">
          <div className="flex items-center gap-2.5">
            <span className="text-[22px]" aria-hidden="true">
              📑
            </span>
            <div>
              <div className="md-contracts-title">{contracts.org}</div>
              <div className="md-contracts-sub">{t('contractsSubtitle')}</div>
            </div>
          </div>
          <PhonePill phone={contracts.phone} office onCopy={onCopy} />
        </div>
      )}
      <table className="md-table">
        <thead>
          <tr>
            <th style={{ width: 50 }}>{t('col.num')}</th>
            <th>{t('col.org')}</th>
            <th>{t('col.officer')}</th>
            <th>{t('col.phone')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={`${it.org}|${it.name}|${it.phone}`} className={it.isSpecial ? 'special' : undefined}>
              <td className="md-num">{idx + 1}</td>
              <td>
                <span className={it.isSpecial ? 'md-org special' : 'md-org'}>
                  {it.isSpecial && '⭐ '}
                  <Highlight text={it.org} query={query} />
                </span>
              </td>
              <td>
                <span className="md-officer">
                  <Highlight text={it.name} query={query} />
                </span>
              </td>
              <td>
                <PhonePill phone={it.phone} office={it.isSpecial} onCopy={onCopy} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function MinistryTable({ items, query, onCopy }: TableProps<ManagersMinistryEntry>) {
  const { t } = useTranslation('managersDirectory');
  if (items.length === 0) return <EmptyState />;
  return (
    <table className="md-table">
      <thead>
        <tr>
          <th style={{ width: 50 }}>{t('col.num')}</th>
          <th style={{ width: 300 }}>{t('col.ministryOfficer')}</th>
          <th>{t('col.ministries')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, idx) => (
          <tr key={`${it.name}|${it.phone}`}>
            <td className="md-num">{idx + 1}</td>
            <td>
              <div className="md-stack">
                <span className="md-officer big">
                  <Highlight text={it.name} query={query} />
                </span>
                <PhonePill phone={it.phone} onCopy={onCopy} />
              </div>
            </td>
            <td>
              <div className="md-ministries">
                {it.ministries.map((m, i) => (
                  <div key={`${i}:${m}`} className="md-ministry">
                    <CheckIcon />
                    <span>
                      <Highlight text={m} query={query} />
                    </span>
                  </div>
                ))}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RegionsTable({ items, query, onCopy }: TableProps<ManagersRegionEntry>) {
  const { t } = useTranslation('managersDirectory');
  if (items.length === 0) return <EmptyState />;
  return (
    <table className="md-table">
      <thead>
        <tr>
          <th style={{ width: 45 }}>{t('col.num')}</th>
          <th>{t('col.region')}</th>
          <th>{t('col.lead')}</th>
          <th>{t('col.leadPhone')}</th>
          <th>{t('col.offices')}</th>
          <th>{t('col.head')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, idx) => (
          <tr key={it.region}>
            <td className="md-num">{idx + 1}</td>
            <td>
              <span className="md-org">
                <Highlight text={it.region} query={query} />
              </span>
            </td>
            <td>
              <span className="md-officer">
                <Highlight text={it.lead} query={query} />
              </span>
            </td>
            <td>
              <div className="md-stack">
                <PhonePill phone={it.leadPhone} onCopy={onCopy} />
                <PhonePill phone={it.extraPhone} onCopy={onCopy} />
              </div>
            </td>
            <td>
              <div className="md-stack">
                {it.offices.map((o, i) => (
                  <PhonePill key={`${i}:${o}`} phone={o} office onCopy={onCopy} />
                ))}
              </div>
            </td>
            <td>
              <div className="md-stack tight">
                {it.head && (
                  <span className="md-lead">
                    <Highlight text={it.head} query={query} />
                  </span>
                )}
                <PhonePill phone={it.headPhone} onCopy={onCopy} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ExatTable({ items, query, onCopy }: TableProps<ManagersExatEntry>) {
  const { t } = useTranslation('managersDirectory');
  return (
    <>
      <div className="md-exat-banner">
        <div className="md-exat-icon">
          <EnvelopeIcon size={24} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="md-exat-head">
            <span className="md-exat-title">{t('exat.bannerTitle')}</span>
            <span className="md-exat-badge">{t('exat.bannerBadge')}</span>
          </div>
          <p className="md-exat-text">
            <Trans t={t} i18nKey="exat.bannerText" components={{ b: <strong /> }} />
          </p>
          <div className="md-exat-note">
            <InfoIcon />
            <span>{t('exat.bannerNote')}</span>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <table className="md-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>{t('col.num')}</th>
              <th>{t('col.service')}</th>
              <th>{t('col.exatOrg')}</th>
              <th>{t('col.desc')}</th>
              <th style={{ minWidth: 220 }}>{t('col.contact')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={`${it.title}|${it.phone}`}>
                <td className="md-num">{idx + 1}</td>
                <td>
                  <div className="md-exat-service">
                    <Highlight text={it.title} query={query} />
                  </div>
                  <div className="md-exat-line">{t('exat.supportLine')}</div>
                </td>
                <td>
                  <span className="md-org exat">
                    <Highlight text={it.org} query={query} />
                  </span>
                </td>
                <td>
                  <span className="md-exat-desc">
                    <Highlight text={it.desc} query={query} />
                  </span>
                </td>
                <td>
                  <PhonePill phone={it.phone} office onCopy={onCopy} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
