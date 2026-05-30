"use client";

import type { ReactNode } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle?: string;
  loading?: boolean;
  onExport?: () => void;
  exportDisabled?: boolean;
  exportLabel?: string;
  controls?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ReservasChartCard({
  title,
  subtitle,
  loading,
  onExport,
  exportDisabled,
  exportLabel = "Exportar CSV",
  controls,
  children,
  className,
}: Props) {
  return (
    <Card className={cn("border-slate-200 bg-white shadow-sm", className)}>
      <CardHeader className="space-y-2 border-b border-slate-100 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold text-slate-900">{title}</CardTitle>
            {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          {onExport ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 text-xs"
              disabled={exportDisabled || loading}
              onClick={onExport}
              aria-label={exportLabel}
            >
              <Download className="mr-1 h-3.5 w-3.5" aria-hidden />
              CSV
            </Button>
          ) : null}
        </div>
        {controls ? <div className="flex flex-wrap items-end gap-2">{controls}</div> : null}
      </CardHeader>
      <CardContent className="pt-3">
        {loading ? (
          <div className="flex h-64 items-center justify-center" aria-busy="true">
            <Loader2 className="h-7 w-7 animate-spin text-[#2fb6b0]" aria-hidden />
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
