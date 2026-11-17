/** Legacy Chart.js look (dashboard.js initCharts) expressed as Recharts props. */
export const AXIS = {
  stroke: 'transparent',
  tick: { fill: 'var(--muted-foreground)', fontSize: 12 },
  tickLine: false,
} as const;

export const GRID = { stroke: 'rgba(255,255,255,0.05)', vertical: true } as const;

export const TOOLTIP = {
  contentStyle: {
    background: 'rgba(15, 23, 42, 0.95)',
    border: '1px solid rgba(59, 130, 246, 0.4)',
    borderRadius: 8,
    padding: 10,
    color: '#e2e8f0',
    fontSize: 12,
  },
  labelStyle: { color: '#ffffff', fontWeight: 700, marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { stroke: 'rgba(148,163,184,0.25)' },
} as const;

export const LEGEND = {
  iconType: 'circle' as const,
  iconSize: 9,
  wrapperStyle: { color: 'var(--muted-foreground)', fontSize: 12, paddingBottom: 8 },
  verticalAlign: 'top' as const,
};
