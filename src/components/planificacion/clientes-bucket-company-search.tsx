"use client";

import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyCompanySearchError,
  applyCompanySearchSuccess,
  CLIENT_BUCKETS_SEARCH_DEBOUNCE_MS,
  CLIENT_BUCKETS_SEARCH_MIN_CHARS,
  initialCompanySearchUiState,
  pickCompanyOnEnter,
  shouldRunCompanySearch,
  type CompanySearchUiState,
} from "@/lib/client-buckets-company-search";
import { searchClientBucketCompanies } from "@/lib/client-buckets-client";
import type { ClientBucketCompanyOption } from "@/lib/client-buckets-types";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

type ClientesBucketCompanySearchProps = {
  levelLabel: string;
  disabled?: boolean;
  onAdd: (company: ClientBucketCompanyOption) => void;
  onError: (message: string) => void;
};

export function ClientesBucketCompanySearch({
  levelLabel,
  disabled,
  onAdd,
  onError,
}: ClientesBucketCompanySearchProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, CLIENT_BUCKETS_SEARCH_DEBOUNCE_MS);
  const [ui, setUi] = useState<CompanySearchUiState>(initialCompanySearchUiState);
  const [selected, setSelected] = useState<ClientBucketCompanyOption | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const latestReqRef = useRef(0);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();

    if (!shouldRunCompanySearch(trimmed)) {
      abortRef.current?.abort();
      abortRef.current = null;
      setUi(initialCompanySearchUiState());
      setSelected(null);
      return;
    }

    const reqId = ++latestReqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setUi((prev) => ({
      ...prev,
      isSearching: true,
      error: null,
    }));

    void searchClientBucketCompanies(trimmed, {
      signal: controller.signal,
      limit: 15,
    })
      .then((res) => {
        setUi((prev) =>
          applyCompanySearchSuccess(prev, reqId, latestReqRef.current, res.items),
        );
        setSelected((prev) => {
          if (prev && res.items.some((o) => o.co_id === prev.co_id)) return prev;
          return null;
        });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : "Error al buscar empresas";
        setUi((prev) => applyCompanySearchError(prev, reqId, latestReqRef.current, message));
        onError(message);
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, onError]);

  const handleSelect = useCallback((opt: ClientBucketCompanyOption) => {
    setSelected(opt);
    setQuery(opt.co_name);
  }, []);

  const handleAdd = useCallback(() => {
    if (!selected) return;
    onAdd(selected);
    setQuery("");
    setSelected(null);
    setUi(initialCompanySearchUiState());
    abortRef.current?.abort();
  }, [selected, onAdd]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const pick = selected ?? pickCompanyOnEnter(ui.options, query);
    if (pick) {
      setSelected(pick);
      if (!selected) setQuery(pick.co_name);
    }
  };

  const showEmpty =
    ui.hasSearched && !ui.isSearching && ui.options.length === 0 && !ui.error;
  const canAdd = Boolean(selected) && !disabled && !ui.isSearching;

  return (
    <div className="space-y-2 border-b border-slate-200 p-2">
      <Label className="text-[10px] text-slate-500">Añadir empresa ({levelLabel})</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Buscar por nombre (mín. 2 caracteres)..."
          className="h-8 pl-7 pr-8 text-xs"
          disabled={disabled}
          aria-autocomplete="list"
          aria-expanded={ui.options.length > 0}
        />
        {ui.isSearching && (
          <Loader2
            className="absolute right-2 top-2 h-4 w-4 animate-spin text-slate-400"
            aria-hidden
          />
        )}
      </div>

      {selected && (
        <p className="text-[10px] text-slate-600">
          Seleccionada: <span className="font-medium text-slate-800">{selected.co_name}</span>
        </p>
      )}

      {ui.error && (
        <p className="text-[10px] text-red-700" role="alert">
          {ui.error}
        </p>
      )}

      {showEmpty && (
        <p className="text-[10px] text-slate-500">No se encontraron empresas.</p>
      )}

      {ui.options.length > 0 && (
        <ul
          className="max-h-32 space-y-0.5 overflow-y-auto rounded border border-slate-200 bg-white p-1"
          role="listbox"
        >
          {ui.options.map((opt) => {
            const isSelected = selected?.co_id === opt.co_id;
            return (
              <li key={opt.co_id} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  className={`flex w-full items-center rounded px-2 py-1.5 text-left text-[11px] ${
                    isSelected
                      ? "bg-[#0b1131]/10 font-semibold text-[#0b1131]"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => handleSelect(opt)}
                >
                  <span className="truncate" title={opt.co_name}>
                    {opt.co_name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        size="sm"
        className="h-8 w-full text-xs"
        disabled={!canAdd}
        onClick={handleAdd}
      >
        Agregar a {levelLabel}
      </Button>
    </div>
  );
}
