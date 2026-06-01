"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ClientBucketLevel } from "@/lib/client-buckets-types";

type ClientesEmpresaBucketMenuProps = {
  coId: string;
  coName: string;
  currentLevel: ClientBucketLevel | null;
  disabled?: boolean;
  onAssign: (level: ClientBucketLevel) => void;
  onRemove: () => void;
};

export function ClientesEmpresaBucketMenu({
  coId,
  coName,
  currentLevel,
  disabled,
  onAssign,
  onRemove,
}: ClientesEmpresaBucketMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="h-6 w-6 text-slate-500"
        disabled={disabled || !coId}
        title={`Asignar bolsa: ${coName}`}
        aria-label={`Asignar ${coName} a bolsa`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-0.5 min-w-[9rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg">
            {([1, 2, 3] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${
                  currentLevel === lvl ? "font-semibold text-[#0b1131]" : "text-slate-700"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onAssign(lvl);
                }}
              >
                Asignar Nivel {lvl}
              </button>
            ))}
            {currentLevel != null && (
              <button
                type="button"
                className="block w-full border-t border-slate-100 px-3 py-1.5 text-left text-xs text-red-700 hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onRemove();
                }}
              >
                Quitar de bolsas
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
