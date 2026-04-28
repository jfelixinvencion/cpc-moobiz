This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Calidad - Auditoria del Servicio

La implementacion de Auditoria del Servicio (tabla, API, UI y storage privado con signed URLs) esta documentada en:

- `docs/quality-audit.md`

## Producto "VIP LIMA" (dashboard + datos)

Se agregó `VIP LIMA` como categoría diferenciada para la gráfica **Pendientes por franja de programacion**:

- aparece en leyenda/filtros/toggle igual que BUS, FURGON, VAN, SPRINTER, LOGISTICA y PROVINCIA VIP,
- usa color propio (`#8E44AD`),
- deja de agruparse en `Otros`,
- disponible en API con filtro `?product=VIP%20LIMA`.

### Migración SQL (staging/prod)

Archivo:

- `sql/20260428_add_vip_lima_product.sql`

Pasos sugeridos:

1) **Dry-run (conteo de filas candidatas):**

```sql
SELECT count(*) AS candidatos
FROM public.viajes_activos
WHERE upper(coalesce(producto, '')) LIKE '%VIP%LIMA%';
```

2) **Backup de filas afectadas antes del update:**

```sql
CREATE TABLE IF NOT EXISTS public.backup_vip_lima_viajes_activos_20260428 AS
SELECT *
FROM public.viajes_activos
WHERE upper(coalesce(producto, '')) LIKE '%VIP%LIMA%';
```

3) **Aplicar migración** en Supabase SQL editor o `psql`:

```bash
psql "<SUPABASE_CONNECTION_STRING_REDACTED>" -f sql/20260428_add_vip_lima_product.sql
```

4) **Rollback** (si aplica) restaurando desde backup:

```sql
UPDATE public.viajes_activos v
SET producto = b.producto
FROM public.backup_vip_lima_viajes_activos_20260428 b
WHERE v.id = b.id;
```

### QA manual rápido

1. Ir a `Dashboard -> Reservas`.
2. En "Pendientes por franja de programacion", verificar que aparece `VIP LIMA` en la leyenda.
3. Click en `VIP LIMA`: debe ocultar/mostrar la serie.
4. Doble click en `VIP LIMA`: debe aislar solo esa categoría.
5. Confirmar tooltip con nombre `VIP LIMA` y conteo correcto.
