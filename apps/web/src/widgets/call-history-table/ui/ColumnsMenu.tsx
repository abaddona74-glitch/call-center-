import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Icon } from '@/shared/ui/icon';
import { TOGGLEABLE_COLUMNS, type ColumnVisibility } from './CallHistoryTable';
import '../i18n';

/** Legacy "Ustunlar" dropdown (column visibility, persisted). */
export function ColumnsMenu({
  visibility,
  onChange,
}: {
  visibility: ColumnVisibility;
  onChange: (v: ColumnVisibility) => void;
}) {
  const { t } = useTranslation('callHistory');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/8 bg-sidebar/75 px-[11px] text-xs font-semibold text-foreground transition-all hover:border-chart-4/40"
        >
          <Icon name="chart" className="size-3.5 text-chart-4" />
          {t('columns')}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[235px] rounded-xl border-chart-4/35 bg-sidebar p-2.5">
        <DropdownMenuLabel className="flex items-center justify-between px-1 text-[11px] font-bold tracking-[0.5px] text-muted-foreground uppercase">
          {t('columnsTitle')}
          <button
            type="button"
            className="text-[11px] font-semibold text-chart-4 normal-case"
            onClick={() => onChange({})}
          >
            {t('columnsAll')}
          </button>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TOGGLEABLE_COLUMNS.map((id) => (
          <DropdownMenuCheckboxItem
            key={id}
            checked={visibility[id] !== false}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) => onChange({ ...visibility, [id]: checked === true })}
            className="text-xs"
          >
            {t(`col.${id}`)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
