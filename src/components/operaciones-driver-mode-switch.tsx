"use client";

import { Button } from "@/components/ui/button";
import { useOperacionesDriverFilters } from "@/context/operaciones-driver-filters-context";
import { cn } from "@/lib/utils";

const TOOLBAR_BTN_PRIMARY =
  "h-8 min-h-8 px-2.5 text-xs font-medium shadow-sm border border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:border-slate-600";
const TOOLBAR_BTN_SECONDARY =
  "h-8 min-h-8 gap-1.5 px-2.5 text-xs font-medium shadow-sm border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900";

type OperacionesDriverModeSwitchProps = {
  className?: string;
};

/** Toggles BASE / NUEVOS compartidos entre Control y Seguimiento operaciones. */
export function OperacionesDriverModeSwitch({ className }: OperacionesDriverModeSwitchProps) {
  const {
    baseFilterEnabled,
    setBaseFilterEnabled,
    activated8dEnabled,
    setActivated8dEnabled,
  } = useOperacionesDriverFilters();

  return (
    <div className={cn("flex shrink-0 gap-2", className)}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={baseFilterEnabled ? TOOLBAR_BTN_PRIMARY : TOOLBAR_BTN_SECONDARY}
        aria-pressed={baseFilterEnabled}
        onClick={() => setBaseFilterEnabled((p) => !p)}
        title="BASE — mostrar solo conductores cuyo fl_name contiene «moobiz» (sin distinguir mayúsculas)."
      >
        BASE
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={activated8dEnabled ? TOOLBAR_BTN_PRIMARY : TOOLBAR_BTN_SECONDARY}
        aria-pressed={activated8dEnabled}
        onClick={() => setActivated8dEnabled((p) => !p)}
        title="NUEVOS — mostrar solo conductores activados en los últimos 8 días (hoy incluido)."
      >
        NUEVOS
      </Button>
    </div>
  );
}
