/** Etiquetas de producto/estado para marcadores del mapa GPS (tooltip y panel). */

export type NearbyServiceDisplayFields = {
  product_name?: string | null;
  pr_name?: string | null;
  status?: string | null;
  state?: string | null;
};

export function resolveNearbyServiceProductName(marker: NearbyServiceDisplayFields): string {
  return String(marker.product_name ?? marker.pr_name ?? "").trim();
}

export function resolveNearbyServiceStatus(marker: NearbyServiceDisplayFields): string {
  const s = String(marker.status ?? marker.state ?? "").trim();
  return s || "—";
}

export function debugLogMapMarker(marker: unknown): void {
  if (process.env.NEXT_PUBLIC_DEBUG_MAP === "1") {
    console.log("[map] marker:", marker);
  }
}
