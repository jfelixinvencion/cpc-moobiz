"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type RefreshDataContextValue = {
  /** Incrementa en cada `triggerRefresh()` para disparar efectos dependientes. */
  refreshKey: number;
  triggerRefresh: () => void;
};

const RefreshDataContext = createContext<RefreshDataContextValue | null>(null);

export function RefreshDataProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const value = useMemo(
    () => ({ refreshKey, triggerRefresh }),
    [refreshKey, triggerRefresh],
  );

  return <RefreshDataContext.Provider value={value}>{children}</RefreshDataContext.Provider>;
}

export function useRefreshData(): RefreshDataContextValue {
  const ctx = useContext(RefreshDataContext);
  if (!ctx) {
    throw new Error("useRefreshData debe usarse dentro de RefreshDataProvider");
  }
  return ctx;
}
