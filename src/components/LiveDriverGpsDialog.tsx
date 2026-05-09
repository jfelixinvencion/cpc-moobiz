"use client";

import { Loader2, ParkingSquare } from "lucide-react";
import type { ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NearbyServiceMarker } from "@/components/LiveDriverMap";
import {
  gpsAvailabilityClass,
  gpsAvailabilityDot,
  gpsAvailabilityLabel,
  formatGpsDate,
} from "@/lib/live-driver-gps-ui";
import type { DriverLiveLocationItem } from "@/lib/moobiz-live-driver-location-client";

type LiveDriverMapProps = {
  lat: number;
  lng: number;
  fullName: string;
  plate: string;
  iconUrl?: string;
  nearbyServices?: NearbyServiceMarker[];
  serviceDestination?: import("@/lib/moobiz-live-driver-location-client").DriverLiveServiceDestination | null;
};

export type LiveDriverGpsDialogState = {
  status: "idle" | "loading" | "success" | "error";
  item: DriverLiveLocationItem | null;
};

export type LiveDriverGpsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Título del modal (nombre conductor en vista). */
  driverTitle: string | null;
  gpsModalState: LiveDriverGpsDialogState;
  /** Marcadores de servicios en el mapa (Seguimiento pasa los de `moobiz_services_maestra` por conductor). */
  nearbyServices: NearbyServiceMarker[];
  LiveMapComponent: ComponentType<LiveDriverMapProps> | null;
  /** Key estable para remount del mapa (p. ej. dr_id o nombre). */
  mapKey: string | null;
};

/**
 * Modal de mapa GPS + detalle del vehículo. Misma estructura visual que
 * `ControlOperacionesPanel` (sin tocar ese archivo).
 */
export function LiveDriverGpsDialog({
  open,
  onOpenChange,
  driverTitle,
  gpsModalState,
  nearbyServices,
  LiveMapComponent,
  mapKey,
}: LiveDriverGpsDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        className="sm:max-w-3xl"
        showCloseButton
        overlayClassName="fixed inset-0 isolate z-50 bg-black/55 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center justify-between gap-2">
            <span className="truncate">{driverTitle ?? "Ubicación GPS"}</span>
            {gpsModalState.status === "success" && gpsModalState.item ? (
              <Badge variant="outline" className={gpsAvailabilityClass(gpsModalState.item.availability)}>
                {gpsAvailabilityDot(gpsModalState.item.availability)}{" "}
                {gpsAvailabilityLabel(gpsModalState.item.availability)}
              </Badge>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {gpsModalState.status === "loading" ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            <p className="text-sm text-slate-600">Obteniendo ubicación GPS...</p>
          </div>
        ) : gpsModalState.status === "error" ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3">
            <p className="text-sm text-slate-700">GPS no disponible para este conductor</p>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </div>
        ) : gpsModalState.status === "success" && gpsModalState.item && open ? (
          <div className="space-y-3">
            {LiveMapComponent ? (
              <LiveMapComponent
                key={mapKey ?? "map"}
                lat={gpsModalState.item.lat}
                lng={gpsModalState.item.lng}
                fullName={gpsModalState.item.full_name}
                plate={gpsModalState.item.plate}
                iconUrl={gpsModalState.item.icon || undefined}
                nearbyServices={nearbyServices}
              />
            ) : (
              <div className="flex h-[320px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            )}
            <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>🚗 Placa: {gpsModalState.item.plate || "—"}</p>
              <p>📍 Código: {gpsModalState.item.code || "—"}</p>
              <p>🕐 Último GPS: {gpsModalState.item.txt_tracked || "—"}</p>
              <p>📅 Fecha: {formatGpsDate(gpsModalState.item.date_tracked)}</p>
              {String(gpsModalState.item.parked_address ?? "").trim() ? (
                <p className="flex items-start gap-2">
                  <ParkingSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" aria-hidden />
                  <span>Últ. posición parado: {String(gpsModalState.item.parked_address).trim()}</span>
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-end">
          {gpsModalState.status === "success" && gpsModalState.item ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const { lat, lng } = gpsModalState.item as DriverLiveLocationItem;
                window.open(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
            >
              Abrir en Google Maps
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
