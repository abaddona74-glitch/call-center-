/** Legacy Chart.js look (dashboard.js initCharts) expressed as Recharts props. */
export const AXIS = {
  stroke: 'transparent',
  tick: { fill: 'var(--muted-foreground)', fontSize: 12 },
  tickLine: false,
} as const;

export const GRID = { stroke: 'color-mix(in srgb, var(--tint) 5%, transparent)', vertical: true } as const;

export const TOOLTIP = {
  contentStyle: {
    background: 'color-mix(in srgb, var(--glass) 95%, transparent)',
    border: '1px solid rgba(59, 130, 246, 0.4)',
    borderRadius: 8,
    padding: 10,
    color: 'var(--foreground)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--ink)', fontWeight: 700, marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { stroke: 'color-mix(in srgb, var(--mute) 25%, transparent)' },
} as const;
