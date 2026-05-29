"use client";

import type { ReservasGranularity } from "@/lib/aggregations-reservas";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ReservasGranularity; label: string }[] = [
  { value: "hour", label: "Hora" },
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
];

type Props = {
  value: ReservasGranularity;
  onChange: (value: ReservasGranularity) => void;
  disabled?: boolean;
};

export function GranularityToggle({ value, onChange, disabled }: Props) {
  return (
    <div
      className="inline-flex flex-wrap rounded-md border border-slate-200 bg-slate-50 p-0.5"
      role="radiogroup"
      aria-label="Granularidad temporal"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          disabled={disabled}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
            disabled && "cursor-not-allowed opacity-60",
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
