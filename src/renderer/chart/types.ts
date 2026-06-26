import type * as echarts from 'echarts';

export const EXPLICIT_FONT_SIZE = Symbol('pptxExplicitFontSize');

export interface SeriesData {
  name: string;
  order: number;
  categories: string[];
  values: number[];
  xValues?: number[];
  bubbleSizes?: number[];
  colorHex?: string | object;
  dataPointColors?: (string | undefined)[];
  dataPointStyles?: (DataPointStyle | undefined)[];
  formatCode?: string;
  blankIndices?: Set<number>;
  invertIfNegative?: boolean;
  markerSymbol?: string;
  markerSize?: number;
  smooth?: boolean;
  lineWidth?: number;
  lineNoFill?: boolean;
}

export type ChartLineType = 'solid' | 'dashed' | 'dotted';

export interface ChartLineStyle {
  color?: string;
  width?: number;
  type?: ChartLineType;
}

export const DEFAULT_CHART_FOREGROUND_COLOR = '#000000';
export const DEFAULT_CHART_AXIS_LABEL_FONT_SIZE = 10;
export const DEFAULT_CHART_AXIS_LINE_COLOR = '#898989';
export const DEFAULT_MAJOR_GRIDLINE_STYLE: Required<ChartLineStyle> = {
  color: DEFAULT_CHART_AXIS_LINE_COLOR,
  width: 1,
  type: 'solid',
};
export const DEFAULT_RADAR_GRIDLINE_STYLE: Required<ChartLineStyle> = {
  color: '#868686',
  width: 1,
  type: 'solid',
};
export const CHART_ACCENT_KEYS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

export interface DataPointStyle {
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  borderType?: ChartLineType;
}

export interface AxisInfo {
  deleted: boolean;
  tickLblPos: string;
  crosses?: string;
  numFmt?: string;
  min?: number;
  max?: number;
  hasMajorGridlines: boolean;
  majorTickMark?: string;
  orientation: string;
  title?: string;
  titleStyle?: ChartTextStyle;
  titleRotation?: number;
  labelColor?: string;
  labelFontSize?: number;
  lineColor?: string;
  majorGridlineStyle?: ChartLineStyle;
}

export interface DataLabelConfig {
  deleted?: boolean;
  showVal: boolean;
  showCatName: boolean;
  showSerName: boolean;
  showPercent: boolean;
  position?: string;
  showLeaderLines?: boolean;
  manualLayout?: DataLabelManualLayout;
  color?: string;
  fontSize?: number;
  bold?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  padding?: [number, number, number, number];
}

export type DataLabelManualLayout = Partial<Record<'x' | 'y' | 'width' | 'height', number>>;

export type ChartTextStyle = {
  color?: string;
  fontSize?: number;
  bold?: boolean;
  fontFamily?: string;
  textShadowColor?: string;
  textShadowBlur?: number;
  textShadowOffsetX?: number;
  textShadowOffsetY?: number;
  [EXPLICIT_FONT_SIZE]?: true;
};

export interface ChartFrameStyle {
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: ChartLineType;
}

export function markExplicitFontSize<T extends object>(style: T): T {
  (style as ChartTextStyle)[EXPLICIT_FONT_SIZE] = true;
  return style;
}

export function hasExplicitFontSize(style: unknown): boolean {
  return Boolean(
    style && typeof style === 'object' && (style as Record<symbol, unknown>)[EXPLICIT_FONT_SIZE],
  );
}

export interface MutableAxisOption {
  type?: string;
  min?: number;
  max?: number;
  interval?: number;
  z?: number;
  axisLine?: Record<string, unknown>;
  axisLabel?: {
    fontSize?: number;
    fontFamily?: string;
    margin?: number;
  };
}

export type OoxmlChartType =
  | 'barChart'
  | 'bar3DChart'
  | 'lineChart'
  | 'line3DChart'
  | 'areaChart'
  | 'area3DChart'
  | 'pieChart'
  | 'pie3DChart'
  | 'doughnutChart'
  | 'radarChart'
  | 'scatterChart'
  | 'bubbleChart'
  | 'stockChart'
  | 'surface3DChart';

export const CHART_TYPE_ELEMENTS: OoxmlChartType[] = [
  'barChart',
  'bar3DChart',
  'lineChart',
  'line3DChart',
  'areaChart',
  'area3DChart',
  'pieChart',
  'pie3DChart',
  'doughnutChart',
  'radarChart',
  'scatterChart',
  'bubbleChart',
  'stockChart',
  'surface3DChart',
];

export interface LegendInfo {
  option: echarts.EChartsOption['legend'];
  position: 'b' | 't' | 'l' | 'r' | 'tr';
  overlay: boolean;
  textStyle?: ChartTextStyle & {
    fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | number;
  };
  manualLayout?: Partial<Record<'left' | 'top' | 'width' | 'height', string>>;
}

export interface DataTableInfo {
  seriesArr: SeriesData[];
  showKeys: boolean;
  formatCode?: string;
}
