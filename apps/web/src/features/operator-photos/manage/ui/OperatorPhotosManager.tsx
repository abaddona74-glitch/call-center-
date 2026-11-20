import {
  OPERATOR_PHOTO_MAX_BYTES,
  OPERATOR_PHOTO_MAX_MB,
  OPERATOR_PHOTO_TYPES,
  type OperatorPhotoEntry,
  type OperatorPhotosInfo,
} from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { operatorPhotoKeys, removeOperatorPhoto, uploadOperatorPhoto } from '@/entities/operator-photo';
import { liveSnapshotQuery, telephonyKeys } from '@/entities/telephony';
import { errorText } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Icon } from '@/shared/ui/icon';
import { SettingsButton, SettingsInput } from '@/shared/ui/settings-panel';
import { shrinkPhoto } from '../model/shrink-photo';

const ACCEPT = OPERATOR_PHOTO_TYPES.join(',');

/** "Muattar Karimova" → "MK". */
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/**
 * Settings → "Operator rasmlari": every operator (PBX directory + the live board) with a round preview, upload /
 * replace and remove. The photo shows in the operator cards right away (the server re-publishes the board).
 */
export function OperatorPhotosManager({ initial }: { initial: OperatorPhotosInfo }) {
  const { t } = useTranslation('operatorPhotos');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const { data: live } = useQuery({ ...liveSnapshotQuery, select: (s) => s.operators });

  // Operators on the live board that the PBX directory did not return (no PBX connection) are listed too.
  const operators = useMemo(() => {
    const byExt = new Map(initial.operators.map((o) => [o.extension, o]));
    for (const o of live ?? []) {
      const known = byExt.get(o.extension);
      if (!known) byExt.set(o.extension, { extension: o.extension, name: o.name, photoUrl: null, updatedAt: null });
      else if (!known.name) byExt.set(o.extension, { ...known, name: o.name });
    }
    return [...byExt.values()].sort((a, b) => Number(a.extension) - Number(b.extension));
  }, [initial.operators, live]);

  const q = search.trim().toLowerCase();
  const visible = q
    ? operators.filter((o) => o.extension.includes(q) || (o.name ?? '').toLowerCase().includes(q))
    : operators;
  const withPhoto = operators.filter((o) => o.photoUrl).length;

  const applied = (info: OperatorPhotosInfo) => {
    queryClient.setQueryData(operatorPhotoKeys.all, info);
    // The open board gets `telephony.operators` from the server; a cached snapshot elsewhere must not keep the old URL.
    void queryClient.invalidateQueries({ queryKey: telephonyKeys.snapshot });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SettingsInput
          type="search"
          className="min-w-[220px] flex-1"
          aria-label={t('search')}
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-[12px] font-semibold text-mute">{t('count', { count: withPhoto })}</span>
      </div>
      <p className="text-[11.5px] text-mute">{t('hint')}</p>
      {!initial.directoryAvailable && <p className="text-[11.5px] text-caution">{t('noDirectory')}</p>}

      {visible.length === 0 ? (
        <div className="rounded-[10px] border border-tint/[0.07] p-4 text-center text-[13px] text-mute">{t('empty')}</div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5">
          {visible.map((op) => (
            <PhotoTile key={op.extension} op={op} onApplied={applied} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PhotoTile({ op, onApplied }: { op: OperatorPhotoEntry; onApplied: (info: OperatorPhotosInfo) => void }) {
  const { t } = useTranslation('operatorPhotos');
  const input = useRef<HTMLInputElement>(null);
  const name = op.name || t('operator', { ext: op.extension });
  const [broken, setBroken] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { blob, name: fileName } = await shrinkPhoto(file);
      return uploadOperatorPhoto(op.extension, blob, fileName);
    },
    onSuccess: (info) => {
      setBroken(false);
      onApplied(info);
      toast.success(t('saved', { name }));
    },
    onError: (err) => toast.error(errorText(err, t('failed'))),
  });
  const remove = useMutation({
    mutationFn: () => removeOperatorPhoto(op.extension),
    onSuccess: (info) => {
      setConfirming(false);
      onApplied(info);
      toast.success(t('removed', { name }));
    },
    onError: (err) => toast.error(errorText(err, t('failed'))),
  });
  const busy = upload.isPending || remove.isPending;

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!(OPERATOR_PHOTO_TYPES as readonly string[]).includes(file.type)) return void toast.error(t('badType'));
    if (file.size > OPERATOR_PHOTO_MAX_BYTES) return void toast.error(t('tooBig', { mb: OPERATOR_PHOTO_MAX_MB }));
    upload.mutate(file);
  };

  return (
    <li className="flex items-center gap-3 rounded-[12px] border border-tint/[0.08] bg-tint/[0.03] p-3">
      <span
        className={cn(
          'flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-tint/[0.06] text-[17px] font-bold text-mute',
          op.photoUrl ? 'border-primary/60' : 'border-tint/15',
        )}
      >
        {op.photoUrl && !broken ? (
          <img src={op.photoUrl} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
        ) : (
          initials(name) || op.extension
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-ink" title={name}>
          {name}
        </div>
        <div className="text-[11.5px] text-mute">
          Exten {op.extension} · {op.photoUrl ? t('withPhoto') : t('noPhoto')}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <SettingsButton size="sm" tone="primary" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="export" className="size-3.5" />
            {upload.isPending ? t('uploading') : op.photoUrl ? t('replace') : t('upload')}
          </SettingsButton>
          {op.photoUrl && (
            <SettingsButton
              size="sm"
              tone="danger"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <Icon name="trash" className="size-3.5" />
              {t('remove')}
            </SettingsButton>
          )}
        </div>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('removeConfirm', { name })}
          confirmLabel={t('remove')}
          cancelLabel={t('cancel')}
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </li>
  );
}
