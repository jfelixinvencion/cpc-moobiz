"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

type Props = {
  options: Option[];
  value: string | null;
  onChange: (value: string | null) => void;
  loading?: boolean;
};

export function FlotaConductorNameSelect({ options, value, onChange, loading }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? "",
    [options, value],
  );

  useEffect(() => {
    if (!value) {
      setQuery("");
      return;
    }
    if (selectedLabel) setQuery(selectedLabel);
  }, [value, selectedLabel]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 80);
    return options
      .filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      .slice(0, 80);
  }, [options, query]);

  return (
    <div ref={rootRef} className="relative min-w-[220px] flex-1 space-y-1">
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Buscar por Nombre o ID (seleccione uno)
      </Label>
      <Input
        className="h-8 text-xs"
        placeholder={loading ? "Cargando…" : "Escriba ID o nombre…"}
        value={query}
        disabled={loading}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value.trim()) onChange(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            if (!value) setQuery("");
          }
        }}
      />
      {open && filtered.length > 0 ? (
        <ul
          className="absolute z-50 mt-1 max-h-52 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-xs shadow-lg"
          role="listbox"
        >
          <li>
            <button
              type="button"
              className="w-full px-2 py-1.5 text-left text-slate-500 hover:bg-slate-50"
              onClick={() => {
                onChange(null);
                setQuery("");
                setOpen(false);
              }}
            >
              Todos
            </button>
          </li>
          {filtered.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={value === o.value}
                className={cn(
                  "w-full px-2 py-1.5 text-left hover:bg-slate-50",
                  value === o.value && "bg-slate-100 font-medium",
                )}
                onClick={() => {
                  onChange(o.value);
                  setQuery(o.label);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
