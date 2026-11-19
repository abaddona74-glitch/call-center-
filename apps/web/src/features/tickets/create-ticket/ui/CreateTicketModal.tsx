import { type TicketOrganization, type TicketOrganizationRef, formatUzPhone } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useContactLookup } from '@/entities/contact';
import {
  DocViewer,
  Dropzone,
  KdsAction,
  KdsField,
  KdsInput,
  KdsSelect,
  KdsTextarea,
  PreviewStrip,
  type ViewerSource,
  acceptFiles,
  createTicket,
  refName,
  ticketCallPrefillQuery,
  ticketDirectoriesQuery,
  ticketKeys,
  usePasteTarget,
} from '@/entities/ticket';
import { Icon } from '@/shared/ui/icon';
import {
  KdsCloseButton,
  KdsIdBadge,
  KdsModal,
  KdsModalActions,
  KdsModalBody,
  KdsModalHeader,
} from '@/shared/ui/kds-modal';
import { LegacyIcon } from '@/shared/ui/legacy-icon';
import { organizationPlace } from '../model/organization-place';
import { OrganizationPicker } from './OrganizationPicker';

/** Stable default: a fresh `[]` per render would re-run the "load initial files" effect forever. */
const NO_FILES: File[] = [];

/**
 * New ticket: region + city/district + organization + category + description + attachments. With `callId` (a call in
 * progress, or a call picked in the history) the number comes from the call on the server; the form only
 * shows it. Picking an organization from the registry fills its region and city/district (both stay
 * editable). Ctrl+V adds screenshots while open.
 */
export function CreateTicketModal({
  open,
  onOpenChange,
  maxFileMb,
  callId = null,
  initialFiles = NO_FILES,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxFileMb: number;
  callId?: string | null;
  initialFiles?: File[];
  onCreated?: (id: number) => void;
}) {
  const { t, i18n } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const dirs = useQuery({ ...ticketDirectoriesQuery, enabled: open });
  const prefill = useQuery({ ...ticketCallPrefillQuery(callId ?? ''), enabled: open && Boolean(callId) });
  const contactOf = useContactLookup();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [regionId, setRegionId] = useState('');
  const [cityId, setCityId] = useState('');
  const [organization, setOrganization] = useState<TicketOrganizationRef | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [viewer, setViewer] = useState<ViewerSource | null>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setFiles(acceptFiles([], initialFiles, maxFileMb, t));
  }, [open, initialFiles, maxFileMb, t]);

  const callPhone = prefill.data?.phone ?? null;
  // Prefill the citizen's name from the client book (when this user may see it).
  useEffect(() => {
    const p = callId ? callPhone : phone;
    const contact = contactOf(p);
    if (contact?.name && !name) setName(contact.name);
  }, [callId, callPhone, phone, contactOf, name]);

  usePasteTarget(open && viewer === null, (pasted) => setFiles((cur) => acceptFiles(cur, pasted, maxFileMb, t)));

  const reset = () => {
    setPhone('');
    setName('');
    setRegionId('');
    setCityId('');
    setOrganization(null);
    setCategoryId('');
    setDescription('');
    setFiles([]);
  };

  const create = useMutation({
    mutationFn: () =>
      createTicket({
        callId: callId ?? undefined,
        phone: callId ? undefined : phone.trim(),
        customerName: name.trim() || undefined,
        organizationId: organization?.id ?? '',
        organizationName: organization && organization.id === null ? organization.name : undefined,
        regionId: Number(regionId),
        cityId: cityId ? Number(cityId) : '',
        categoryId: Number(categoryId),
        description: description.trim(),
        files,
      }),
    onSuccess: async (detail) => {
      toast.success(t('form.created', { code: detail.code }));
      reset();
      onOpenChange(false);
      onCreated?.(detail.id);
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });

  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  // A registry organization knows its region and district: fill them in. A typed one, a republic-level
  // one or a district with no matching city leaves what the operator chose.
  const pickOrganization = (ref: TicketOrganizationRef | null, registry?: TicketOrganization) => {
    setOrganization(ref);
    const place = registry ? organizationPlace(registry, dirs.data?.regions ?? []) : null;
    if (!place) return;
    const region = String(place.regionId);
    if (region !== regionId) {
      setRegionId(region);
      setCityId(place.cityId === null ? '' : String(place.cityId));
    } else if (place.cityId !== null) setCityId(String(place.cityId));
  };

  const regions = (dirs.data?.regions ?? []).filter((r) => r.isActive);
  const cities = regions.find((r) => String(r.id) === regionId)?.cities.filter((c) => c.isActive) ?? [];
  const categories = (dirs.data?.categories ?? []).filter((c) => c.isActive);
  const source = !callId
    ? t('form.sourceManual')
    : prefill.data?.source === 'live'
      ? t('form.sourceLive')
      : t('form.sourceHistory');
  const openTickets = prefill.data?.openTickets ?? [];

  return (
    <KdsModal open={open} onOpenChange={close} title={t('form.newTitle')} width={660} closeOnBackdrop>
      <form
        className="flex flex-1 flex-col overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !regionId ||
            !organization ||
            !categoryId ||
            description.trim().length < 3 ||
            (!callId && !phone.trim())
          ) {
            toast.warning(t('form.required'));
            return;
          }
          create.mutate();
        }}
      >
        <KdsModalHeader>
          <div className="flex items-center gap-3">
            <KdsIdBadge>{t('form.newBadge')}</KdsIdBadge>
            <h3 className="m-0 text-base font-bold text-ink">{t('form.newTitle')}</h3>
            <span className="rounded-md border border-tint/10 bg-tint/5 px-2 py-0.5 text-[11px] font-semibold text-mute">
              {source}
            </span>
          </div>
          <KdsCloseButton label={t('box.close')} />
        </KdsModalHeader>
        <KdsModalBody className="gap-1">
          <div className="grid gap-x-3 sm:grid-cols-2">
            <KdsField label={t('form.phone')} icon={<Icon name="call" className="size-3.5" />} htmlFor="kds-new-phone">
              {callId ? (
                <div
                  id="kds-new-phone"
                  title={t('form.phoneFromCall')}
                  className="rounded-[10px] border border-[rgba(56,189,248,0.3)] bg-[rgba(56,189,248,0.08)] px-3.5 py-2.5 text-[13.5px] font-bold text-info"
                >
                  {prefill.isPending
                    ? t('form.callLoading')
                    : callPhone
                      ? formatUzPhone(callPhone)
                      : prefill.isError
                        ? prefill.error.message
                        : '—'}
                </div>
              ) : (
                <KdsInput
                  id="kds-new-phone"
                  value={phone}
                  maxLength={32}
                  inputMode="tel"
                  required
                  placeholder="+998 90 123 45 67"
                  onChange={(e) => setPhone(e.target.value)}
                />
              )}
            </KdsField>
            <KdsField label={t('form.name')} icon={<Icon name="user" className="size-3.5" />} htmlFor="kds-new-name">
              <KdsInput
                id="kds-new-name"
                value={name}
                maxLength={120}
                placeholder={t('form.namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
              />
            </KdsField>
          </div>
          {openTickets.length > 0 && (
            <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.1)] px-3 py-2 text-xs font-semibold text-caution">
              <LegacyIcon name="alert-circle" className="size-4" />
              {t('form.openTickets', { codes: openTickets.map((o) => o.code).join(', ') })}
            </div>
          )}
          <div className="grid gap-x-3 sm:grid-cols-2">
            <KdsField
              label={t('form.region')}
              icon={<Icon name="location" className="size-3.5" />}
              htmlFor="kds-new-region"
            >
              <KdsSelect
                id="kds-new-region"
                required
                value={regionId}
                onChange={(e) => {
                  setRegionId(e.target.value);
                  setCityId('');
                }}
              >
                <option value="">{t('form.regionPick')}</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {refName(r, i18n.language)}
                  </option>
                ))}
              </KdsSelect>
            </KdsField>
            <KdsField label={t('form.city')} icon={<Icon name="global" className="size-3.5" />} htmlFor="kds-new-city">
              <KdsSelect
                id="kds-new-city"
                value={cityId}
                disabled={!regionId || cities.length === 0}
                onChange={(e) => setCityId(e.target.value)}
              >
                <option value="">{t('form.cityAny')}</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {refName(c, i18n.language)}
                  </option>
                ))}
              </KdsSelect>
            </KdsField>
          </div>
          <KdsField
            label={t('form.organization')}
            icon={<Building2 className="size-3.5" />}
            htmlFor="kds-new-organization"
          >
            <OrganizationPicker
              id="kds-new-organization"
              regionId={regionId ? Number(regionId) : null}
              value={organization}
              onChange={pickOrganization}
            />
          </KdsField>
          <KdsField
            label={t('form.category')}
            icon={<Icon name="folder" className="size-3.5" />}
            htmlFor="kds-new-category"
          >
            <KdsSelect
              id="kds-new-category"
              required
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{t('form.categoryPick')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {refName(c, i18n.language)}
                </option>
              ))}
            </KdsSelect>
          </KdsField>
          <KdsField
            label={t('form.description')}
            icon={<LegacyIcon name="message" className="size-3.5" />}
            htmlFor="kds-new-description"
          >
            <KdsTextarea
              id="kds-new-description"
              ref={descRef}
              required
              value={description}
              maxLength={4000}
              placeholder={t('form.descriptionPlaceholder')}
              onChange={(e) => setDescription(e.target.value)}
            />
          </KdsField>
          <KdsField label={t('form.files')} icon={<LegacyIcon name="gallery" className="size-3.5" />}>
            <Dropzone onFiles={(added) => setFiles((cur) => acceptFiles(cur, added, maxFileMb, t))} />
            <PreviewStrip
              files={files}
              onRemove={(i) => setFiles((cur) => cur.filter((_, idx) => idx !== i))}
              onOpen={(file) => setViewer({ kind: 'local', file })}
            />
          </KdsField>
        </KdsModalBody>
        <KdsModalActions>
          <KdsAction variant="delete" onClick={() => close(false)}>
            {t('form.cancel')}
          </KdsAction>
          <KdsAction type="submit" variant="primary" disabled={create.isPending || (Boolean(callId) && !callPhone)}>
            {create.isPending ? t('form.sending') : t('form.submit')}
          </KdsAction>
        </KdsModalActions>
      </form>
      <DocViewer source={viewer} onClose={() => setViewer(null)} />
    </KdsModal>
  );
}
