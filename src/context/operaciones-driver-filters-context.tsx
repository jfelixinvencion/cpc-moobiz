"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  driverMetaMatchesOperacionesFilters,
  normalizeConductorFilterKey,
  type ControlDriverFilterMeta,
} from "@/lib/control-operaciones-driver-filters";

type RegisterableDriver = {
  nombre_conductor?: string | null;
  fl_name?: string | null;
  fecha_activacion?: string | null;
};

type OperacionesDriverFiltersContextValue = {
  baseFilterEnabled: boolean;
  setBaseFilterEnabled: Dispatch<SetStateAction<boolean>>;
  activated8dEnabled: boolean;
  setActivated8dEnabled: Dispatch<SetStateAction<boolean>>;
  registerDriverMetas: (drivers: RegisterableDriver[]) => void;
  conductorMatchesFilters: (conductorDisplayName: string) => boolean;
  ensureDriverMetaLoaded: () => Promise<void>;
};

const OperacionesDriverFiltersContext =
  createContext<OperacionesDriverFiltersContextValue | null>(null);

export function OperacionesDriverFiltersProvider({ children }: { children: ReactNode }) {
  const [baseFilterEnabled, setBaseFilterEnabled] = useState(false);
  const [activated8dEnabled, setActivated8dEnabled] = useState(false);
  const metaByConductorKeyRef = useRef<Map<string, ControlDriverFilterMeta>>(new Map());
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const registerDriverMetas = useCallback((drivers: RegisterableDriver[]) => {
    const map = metaByConductorKeyRef.current;
    for (const d of drivers) {
      const name = String(d.nombre_conductor ?? "").trim();
      if (!name) continue;
      map.set(normalizeConductorFilterKey(name), {
        fl_name: d.fl_name ?? null,
        fecha_activacion: d.fecha_activacion ?? null,
      });
    }
  }, []);

  const ensureDriverMetaLoaded = useCallback(async () => {
    if (metaByConductorKeyRef.current.size > 0) return;
    if (loadPromiseRef.current) {
      await loadPromiseRef.current;
      return;
    }
    loadPromiseRef.current = (async () => {
      try {
        const res = await fetch("/api/control-operaciones", { cache: "no-store" });
        const j = (await res.json()) as {
          drivers?: RegisterableDriver[];
          error?: string;
        };
        if (!res.ok) throw new Error(j.error || "Error al cargar metadatos de conductores");
        if (Array.isArray(j.drivers)) registerDriverMetas(j.drivers);
      } finally {
        loadPromiseRef.current = null;
      }
    })();
    await loadPromiseRef.current;
  }, [registerDriverMetas]);

  const conductorMatchesFilters = useCallback(
    (conductorDisplayName: string) => {
      const key = normalizeConductorFilterKey(conductorDisplayName);
      const meta = metaByConductorKeyRef.current.get(key);
      return driverMetaMatchesOperacionesFilters(
        meta,
        baseFilterEnabled,
        activated8dEnabled,
      );
    },
    [baseFilterEnabled, activated8dEnabled],
  );

  const value = useMemo(
    () => ({
      baseFilterEnabled,
      setBaseFilterEnabled,
      activated8dEnabled,
      setActivated8dEnabled,
      registerDriverMetas,
      conductorMatchesFilters,
      ensureDriverMetaLoaded,
    }),
    [
      baseFilterEnabled,
      activated8dEnabled,
      registerDriverMetas,
      conductorMatchesFilters,
      ensureDriverMetaLoaded,
    ],
  );

  return (
    <OperacionesDriverFiltersContext.Provider value={value}>
      {children}
    </OperacionesDriverFiltersContext.Provider>
  );
}

export function useOperacionesDriverFilters(): OperacionesDriverFiltersContextValue {
  const ctx = useContext(OperacionesDriverFiltersContext);
  if (!ctx) {
    throw new Error(
      "useOperacionesDriverFilters debe usarse dentro de OperacionesDriverFiltersProvider",
    );
  }
  return ctx;
}
