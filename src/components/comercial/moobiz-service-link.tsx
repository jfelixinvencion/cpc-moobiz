"use client";

import { ExternalLink } from "lucide-react";

import { ID_SERVICIO_REGEX, MOOBIZ_SERVICE_URL } from "@/lib/comercial-quejas";
import { cn } from "@/lib/utils";

type Props = {
  idServicio: string;
  className?: string;
};

export function MoobizServiceLink({ idServicio, className }: Props) {
  const valid = ID_SERVICIO_REGEX.test(idServicio.trim());
  const href = `${MOOBIZ_SERVICE_URL}${idServicio.trim()}`;

  return (
    <a
      href={valid ? href : undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir en Moobiz"
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded border text-[10px] transition-colors",
        valid
          ? "border-[#00e676] bg-[#00e676]/15 text-[#0b1131] hover:bg-[#00e676]/30"
          : "pointer-events-none border-slate-200 bg-slate-100 text-slate-300",
        className,
      )}
      onClick={(e) => {
        if (!valid) e.preventDefault();
      }}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}
