"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  loading?: boolean;
  className?: string;
};

const MENU_W = 224;

export function ProductividadFilterMulti({
  label,
  options,
  selected,
  onChange,
  loading,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - MENU_W - 8),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const summary =
    selected.length === 0
      ? "Todos"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} sel.`;

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const menu =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className="fixed z-[9999] max-h-52 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{ top: menuPos.top, left: menuPos.left, width: MENU_W }}
          >
            <button
              type="button"
              className="block w-full px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
            >
              Limpiar
            </button>
            {options.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-slate-300"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
            {options.length === 0 ? (
              <p className="px-2 py-2 text-xs text-slate-400">Sin opciones</p>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={cn("relative min-w-[7.5rem]", className)} ref={rootRef}>
      <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[#0f5666]/80">
        {label}
      </label>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full justify-between border-slate-200 bg-white px-2 text-xs font-normal text-slate-800"
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            if (next) updateMenuPosition();
            return next;
          });
        }}
        disabled={loading}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate">{loading ? "…" : summary}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </Button>
      {menu}
    </div>
  );
}
