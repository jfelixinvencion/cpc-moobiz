"use client";

import type { ReactNode } from "react";

import { RefreshDataProvider } from "@/context/refresh-data-context";

export function Providers({ children }: { children: ReactNode }) {
  return <RefreshDataProvider>{children}</RefreshDataProvider>;
}
