import type { ComercialQuejaRow } from "@/lib/comercial-quejas-query";

export type { ComercialQuejaRow };

export const TURNOS = ["Mañana", "Tarde", "Noche"] as const;
export const FUENTES = ["Correo", "Llamada", "Whatsapp"] as const;
