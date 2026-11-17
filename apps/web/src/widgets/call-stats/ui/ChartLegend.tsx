/** Chart.js default legend: outlined 40×12 boxes tinted with the series color, muted labels, centered on top. */
export function ChartLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="mb-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <i
            className="inline-block h-3 w-10 border-2"
            style={{ borderColor: i.color, background: `color-mix(in srgb, ${i.color} 15%, transparent)` }}
          />
          {i.name}
        </span>
      ))}
    </div>
  );
}
