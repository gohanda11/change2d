import type { Point2 } from './geometry2d';

export interface LinearDimension {
  kind: 'linear';
  p1: Point2;
  p2: Point2;
  /** 寸法線のオフセット（p1→p2 に対する左法線方向の符号付き距離） */
  offset: number;
}

export interface DiameterDimension {
  kind: 'diameter';
  center: Point2;
  radius: number;
  /** 直径線の角度（ラジアン） */
  angle: number;
  /** 表示テキスト（未設定時は ⌀直径） */
  label?: string;
  /** テキスト位置（モデル座標）。未設定時は直径線付近 */
  labelPosition?: Point2;
}

export type DimensionAnnotation = LinearDimension | DiameterDimension;

export interface TextAnnotation {
  position: Point2;
  content: string;
  height: number;
}

export interface DrawingAnnotations {
  dimensions: DimensionAnnotation[];
  texts: TextAnnotation[];
  hatchEnabled: boolean;
  hatchSpacing?: number;
  hatchAngleDeg?: number;
}

export type DrawingTool = 'pan' | 'dimension' | 'diameter' | 'text';

export interface CircleFeature {
  center: Point2;
  radius: number;
}
