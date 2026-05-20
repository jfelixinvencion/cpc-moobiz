"use client";

import type { ReactElement } from "react";

type LabelGeom = {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: unknown;
};

/** Ancho mínimo (px) para etiqueta en barras horizontales apiladas. */
const MIN_HORIZONTAL_BAR_LABEL_PX = 34;
/** Alto mínimo (px) en gráfica Por fecha. */
const MIN_VERTICAL_BAR_LABEL_PX = 16;
/** Alto mínimo (px) cuando hay muchas barras (Por fecha y hora). */
const MIN_VERTICAL_BAR_LABEL_DENSE_PX = 26;
/** A partir de esta cantidad de barras se aplica umbral más estricto. */
const DENSE_VERTICAL_BAR_COUNT = 20;

function formatBarCount(value: unknown): string {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return "";
  return num.toLocaleString("es-PE");
}

/** Etiqueta en segmentos de barras horizontales (Acciones por usuario). */
export function ProductividadHorizontalBarLabel(props: LabelGeom): ReactElement | null {
  const width = Number(props.width ?? 0);
  const height = Number(props.height ?? 0);
  const text = formatBarCount(props.value);
  if (!text || width < MIN_HORIZONTAL_BAR_LABEL_PX) return null;

  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);

  return (
    <text
      x={x + width - 6}
      y={y + height / 2}
      fill="#fff"
      fontSize={11}
      fontWeight={600}
      textAnchor="end"
      dominantBaseline="middle"
    >
      {text}
    </text>
  );
}

type VerticalBarLabelProps = LabelGeom & {
  barCount?: number;
};

/** Etiqueta en barras verticales (Por fecha / Por fecha y hora). */
export function ProductividadVerticalBarLabel(props: VerticalBarLabelProps): ReactElement | null {
  const height = Number(props.height ?? 0);
  const width = Number(props.width ?? 0);
  const barCount = props.barCount ?? 0;
  const minHeight =
    barCount >= DENSE_VERTICAL_BAR_COUNT
      ? MIN_VERTICAL_BAR_LABEL_DENSE_PX
      : MIN_VERTICAL_BAR_LABEL_PX;

  const text = formatBarCount(props.value);
  if (!text || height < minHeight) return null;

  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const inside = height >= minHeight + 8;

  return (
    <text
      x={x + width / 2}
      y={inside ? y + height / 2 : y - 4}
      fill={inside ? "#fff" : "#0f5666"}
      fontSize={10}
      fontWeight={600}
      textAnchor="middle"
      dominantBaseline={inside ? "middle" : "auto"}
    >
      {text}
    </text>
  );
}
