import type * as echarts from 'echarts';
import { getLegendOptionObject, pickVisualStringColor } from './legend';

export function createLegendIcon(
  icon: string | undefined,
  color: string,
  width: number,
  height: number,
  strokeWidth = 2,
  marker?: string,
): SVGSVGElement | null {
  if (icon === 'none') return null;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.display = 'block';
  const normalized = icon ?? 'rect';

  if (normalized.startsWith('path://')) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', normalized.slice('path://'.length));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(strokeWidth));
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    if (marker && marker !== 'none') {
      const cx = width / 2;
      const cy = height / 2;
      const markerSize = Math.max(3, Math.min(width, height) * 0.55);
      if (marker === 'diamond') {
        const markerPath = document.createElementNS(ns, 'path');
        markerPath.setAttribute(
          'd',
          `M${cx} ${cy - markerSize / 2} L${cx + markerSize / 2} ${cy} L${cx} ${cy + markerSize / 2} L${cx - markerSize / 2} ${cy} Z`,
        );
        markerPath.setAttribute('fill', color);
        svg.appendChild(markerPath);
      } else if (marker === 'rect') {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(cx - markerSize / 2));
        rect.setAttribute('y', String(cy - markerSize / 2));
        rect.setAttribute('width', String(markerSize));
        rect.setAttribute('height', String(markerSize));
        rect.setAttribute('fill', color);
        svg.appendChild(rect);
      } else if (marker === 'triangle') {
        const markerPath = document.createElementNS(ns, 'path');
        markerPath.setAttribute(
          'd',
          `M${cx} ${cy - markerSize / 2} L${cx + markerSize / 2} ${cy + markerSize / 2} L${cx - markerSize / 2} ${cy + markerSize / 2} Z`,
        );
        markerPath.setAttribute('fill', color);
        svg.appendChild(markerPath);
      } else {
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', String(markerSize / 2));
        circle.setAttribute('fill', color);
        svg.appendChild(circle);
      }
    }
    return svg;
  }

  if (normalized === 'diamond') {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute(
      'd',
      `M${width / 2} 1 L${width - 1} ${height / 2} L${width / 2} ${height - 1} L1 ${height / 2} Z`,
    );
    path.setAttribute('fill', color);
    svg.appendChild(path);
    return svg;
  }

  if (normalized === 'circle') {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', String(width / 2));
    circle.setAttribute('cy', String(height / 2));
    circle.setAttribute('r', String(Math.max(2, Math.min(width, height) / 2 - 1)));
    circle.setAttribute('fill', color);
    svg.appendChild(circle);
    return svg;
  }

  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', '1');
  rect.setAttribute('y', '1');
  rect.setAttribute('width', String(Math.max(2, width - 2)));
  rect.setAttribute('height', String(Math.max(2, height - 2)));
  rect.setAttribute('fill', color);
  svg.appendChild(rect);
  return svg;
}

function resolveInsetToPx(value: string | number, total: number): string {
  if (typeof value === 'number') return `${value}px`;
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    const pct = Number.parseFloat(trimmed.slice(0, -1));
    if (!Number.isNaN(pct)) return `${(pct / 100) * total}px`;
  }
  return trimmed;
}

export function buildCustomLegendOverlay(
  option: echarts.EChartsOption,
  size: { w: number; h: number },
): HTMLElement | null {
  const legend = getLegendOptionObject(option.legend);
  if (!legend || legend.show === false) return null;

  const isVertical = legend.orient === 'vertical';
  const isHorizontal = legend.orient === 'horizontal' || legend.orient === undefined;
  const hasHorizontalAnchor =
    legend.top !== undefined ||
    legend.bottom !== undefined ||
    legend.left !== undefined ||
    legend.right !== undefined;
  if (isVertical && legend.left === undefined && legend.right === undefined) return null;
  if (isHorizontal && !hasHorizontalAnchor) return null;

  const palette = Array.isArray(option.color)
    ? option.color.filter((entry): entry is string => typeof entry === 'string')
    : [];

  const rawData = legend.data ?? [];
  type LegendOverlayEntry = {
    name: string;
    icon: string | undefined;
    marker: string | undefined;
    color: string;
    lineWidth: number;
  };
  const seriesList = Array.isArray(option.series)
    ? option.series
    : option.series
      ? [option.series]
      : [];
  const radarSeries =
    seriesList.length === 1 &&
    (seriesList[0] as Record<string, unknown> | undefined)?.type === 'radar'
      ? (seriesList[0] as Record<string, unknown>)
      : undefined;
  const radarData = Array.isArray(radarSeries?.data)
    ? (radarSeries.data as Record<string, unknown>[])
    : undefined;
  const entries = rawData
    .map((item, index) => {
      const name = typeof item === 'string' ? item : item.name;
      const itemIcon = typeof item === 'string' ? undefined : item.icon;
      const itemMarker = typeof item === 'string' ? undefined : item.marker;
      if (!name) return null;
      const series = seriesList[index] as Record<string, unknown> | undefined;
      const visual = radarData?.[index] ?? series;
      const lineStyle = (visual?.lineStyle as Record<string, unknown> | undefined) ?? {};
      const color = pickVisualStringColor(visual, palette[index] ?? '#2f6f8f');
      const lineWidth =
        typeof lineStyle.width === 'number' && Number.isFinite(lineStyle.width)
          ? Math.max(1, lineStyle.width)
          : 2;
      return { name, icon: itemIcon ?? legend.icon, marker: itemMarker, color, lineWidth };
    })
    .filter((entry): entry is LegendOverlayEntry => entry !== null);
  if (entries.length === 0) return null;

  const overlay = document.createElement('div');
  overlay.className = 'pptx-chart-custom-legend';
  overlay.style.position = 'absolute';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = isVertical ? 'column' : 'row';
  overlay.style.gap = isVertical ? '6px' : '12px';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '1';
  overlay.style.whiteSpace = 'nowrap';
  if (legend.left !== undefined) overlay.style.left = resolveInsetToPx(legend.left, size.w);
  if (legend.right !== undefined) overlay.style.right = resolveInsetToPx(legend.right, size.w);
  if (legend.width !== undefined) overlay.style.width = resolveInsetToPx(legend.width, size.w);
  if (legend.height !== undefined) overlay.style.height = resolveInsetToPx(legend.height, size.h);
  if (legend.width !== undefined || legend.height !== undefined) {
    overlay.style.boxSizing = 'border-box';
    if (isHorizontal) {
      overlay.style.alignItems = 'center';
      if (legend.width !== undefined) overlay.style.justifyContent = 'center';
    } else {
      if (legend.width !== undefined) overlay.style.alignItems = 'center';
      if (legend.height !== undefined) overlay.style.justifyContent = 'center';
    }
  }
  const sideLegend =
    legend.orient === 'vertical' && (legend.left !== undefined || legend.right !== undefined);
  if (sideLegend) {
    if (legend.top === 'middle') {
      overlay.style.top = `${size.h / 2}px`;
      overlay.style.transform = 'translateY(-50%)';
    } else if (legend.top !== undefined) {
      overlay.style.top = resolveInsetToPx(legend.top, size.h);
    } else if (legend.bottom === undefined) {
      overlay.style.top = `${size.h / 2}px`;
      overlay.style.transform = 'translateY(-50%)';
    }
  } else if (legend.top !== undefined) {
    overlay.style.top = resolveInsetToPx(legend.top, size.h);
  }
  if (legend.bottom !== undefined) overlay.style.bottom = resolveInsetToPx(legend.bottom, size.h);
  if (isHorizontal && legend.left === undefined && legend.right === undefined) {
    overlay.style.left = '50%';
    overlay.style.transform = 'translateX(-50%)';
  }

  const fontSize = legend.textStyle?.fontSize ?? 10;
  const itemWidth = legend.itemWidth ?? fontSize;
  const itemHeight = legend.itemHeight ?? fontSize;

  for (const entry of entries) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';

    const icon = createLegendIcon(
      entry.icon,
      entry.color,
      itemWidth,
      itemHeight,
      entry.lineWidth,
      entry.marker,
    );
    if (icon) row.appendChild(icon);

    const label = document.createElement('span');
    label.textContent = entry.name;
    label.style.color = legend.textStyle?.color ?? '#000000';
    label.style.fontSize = `${fontSize}px`;
    if (legend.textStyle?.fontFamily) {
      label.style.fontFamily = legend.textStyle.fontFamily;
    }
    if (legend.textStyle?.fontWeight !== undefined) {
      label.style.fontWeight = String(legend.textStyle.fontWeight);
    }
    row.appendChild(label);
    overlay.appendChild(row);
  }

  return overlay;
}
