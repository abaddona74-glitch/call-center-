import { TICKET_ORGANIZATION_NAME_MAX, type TicketOrganization, type TicketOrganizationRef } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KdsInput, ticketOrganizationsQuery } from '@/entities/ticket';
import { cn } from '@/shared/lib/cn';

const DEBOUNCE_MS = 250;

/**
 * The citizen's organization: search the registry (~47 000 rows) by name words or INN — the ticket's
 * region ranks first — or, when it is not there, keep the typed name. Arrow keys + Enter choose.
 * A registry pick also hands over the registry row (region, district) so the form can fill its place.
 */
export function OrganizationPicker({
  id,
  regionId,
  value,
  onChange,
}: {
  id: string;
  regionId: number | null;
  value: TicketOrganizationRef | null;
  onChange: (value: TicketOrganizationRef | null, registry?: TicketOrganization) => void;
}) {
  const { t } = useTranslation('ticket');
  const listId = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  const enabled = query.length >= 2;
  const search = useQuery({ ...ticketOrganizationsQuery(query, regionId), enabled });
  const items: TicketOrganization[] = enabled ? (search.data?.items ?? []) : [];
  const typed = text.replace(/\s+/g, ' ').trim();
  // Last option: keep the typed name (the registry does not have every organization).
  const options = typed.length >= 2 ? items.length + 1 : items.length;

  useEffect(() => setActive(0), [query, regionId]);

  const choose = (index: number) => {
    const org = items[index];
    if (org) onChange({ id: org.id, name: org.name, tin: org.tin }, org);
    else if (typed.length >= 2) onChange({ id: null, name: typed.slice(0, TICKET_ORGANIZATION_NAME_MAX), tin: null });
    else return;
    setOpen(false);
    setText('');
  };

  if (value) {
    return (
      <div
        id={id}
        className="flex items-center gap-3 rounded-[10px] border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.08)] px-3.5 py-2"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-bold text-ink" title={value.name}>
            {value.name}
          </div>
          <div className="text-[11.5px] font-semibold text-mute">
            {value.tin ? t('form.organizationTin', { tin: value.tin }) : t('form.organizationManual')}
          </div>
        </div>
        <button
          type="button"
          title={t('form.organizationClear')}
          aria-label={t('form.organizationClear')}
          className="rounded-md px-2 py-1 text-lg leading-none text-mute hover:bg-tint/10 hover:text-ink"
          onClick={() => {
            onChange(null);
            setText(value.id === null ? value.name : '');
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <KdsInput
        id={id}
        ref={inputRef}
        value={text}
        maxLength={TICKET_ORGANIZATION_NAME_MAX}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && options > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={t('form.organizationPlaceholder')}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && options > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => (i + 1) % options);
          } else if (e.key === 'ArrowUp' && options > 0) {
            e.preventDefault();
            setActive((i) => (i - 1 + options) % options);
          } else if (e.key === 'Enter' && open && options > 0) {
            e.preventDefault();
            choose(active);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && typed.length > 0 && (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-[10px] border border-tint/12 bg-sidebar py-1 shadow-[0_12px_32px_color-mix(in_srgb,var(--shadow-color)_50%,transparent)]"
        >
          {typed.length < 2 ? (
            <div className="px-3.5 py-2 text-xs text-dim">{t('form.organizationHint')}</div>
          ) : (
            <>
              {items.map((org, i) => (
                <div
                  key={org.id}
                  role="option"
                  aria-selected={i === active}
                  className={cn(
                    'cursor-pointer px-3.5 py-2',
                    i === active ? 'bg-[rgba(56,189,248,0.15)]' : 'hover:bg-tint/5',
                  )}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(i);
                  }}
                >
                  <div className="text-[13px] font-semibold text-ink">{org.name}</div>
                  <div className="text-[11.5px] text-mute">
                    {[org.tin && t('form.organizationTin', { tin: org.tin }), org.district].filter(Boolean).join(' · ')}
                  </div>
                </div>
              ))}
              {enabled && search.isFetching && items.length === 0 && (
                <div className="px-3.5 py-2 text-xs text-dim">{t('form.organizationSearching')}</div>
              )}
              {enabled && !search.isFetching && items.length === 0 && (
                <div className="px-3.5 py-2 text-xs text-dim">{t('form.organizationNone')}</div>
              )}
              <div
                role="option"
                aria-selected={active === items.length}
                className={cn(
                  'cursor-pointer border-t border-tint/8 px-3.5 py-2 text-[12.5px] font-semibold text-caution',
                  active === items.length ? 'bg-[rgba(245,158,11,0.15)]' : 'hover:bg-tint/5',
                )}
                onMouseEnter={() => setActive(items.length)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(items.length);
                }}
              >
                {t('form.organizationTyped', { name: typed })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
