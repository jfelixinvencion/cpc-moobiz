// scripts/sync_moobiz_logs_incremental.js
// Reemplazar por este archivo. Pagina con page+limit, dedup, upsert en lotes,
// actualiza sync_state y registra en sync_monitor.
// Recomendado: crear rama y backup antes de reemplazar.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOOBIZ_LOGS_TOKEN = process.env.MOOBIZ_LOGS_TOKEN;
const MOOBIZ_LOGS_URL = "https://app.moobiz.pe/api/admin/logs";

/** Diagnóstico: límite alto para observar respuesta y orden del API; volver a 1000 en producción. */
const PAGE_SIZE = 5000;
const MAX_PAGES = 10; // límite por corrida (10000 registros max)
const DELAY_MS = 300;
const SUPABASE_BATCH_SIZE = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonOrThrow(url, options, label) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${label} failed (${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * Inserta una fila en public.sync_monitor vía PostgREST.
 * No lanza: errores de red o de API solo se registran en consola.
 */
async function safeInsertSyncMonitor(row) {
  const url = `${SUPABASE_URL}/rest/v1/sync_monitor`;
  const body = JSON.stringify({
    status: row.status,
    records_inserted: row.records_inserted,
    pages_queried: row.pages_queried,
    last_id: row.last_id,
    error_message: row.error_message,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(
        "[sync] sync_monitor: insert falló",
        `HTTP ${res.status}`,
        errText || "(cuerpo vacío)"
      );
      return;
    }
    console.log("[sync] sync_monitor: insert OK", `(HTTP ${res.status})`);
  } catch (e) {
    console.error(
      "[sync] sync_monitor: error de red o excepción al insertar:",
      e instanceof Error ? e.message : String(e)
    );
  }
}

async function main() {
  console.log("🚀 Iniciando sync_moobiz_logs_incremental...");
  let status = "success";
  let recordsInserted = 0;
  let pagesQueried = 0;
  let lastIdAfter = "0";
  let errorMessage = null;

  try {
    // 1) Leer last_id desde sync_state
    const lastIdData = await fetchJsonOrThrow(
      `${SUPABASE_URL}/rest/v1/sync_state?key=eq.last_id&select=value`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
      "Read sync_state"
    );
    const lastId = lastIdData.length ? BigInt(lastIdData[0].value) : 0n;
    lastIdAfter = lastId.toString();
    console.log(`[sync] last_id inicial: ${lastId.toString()}`);

    // 2) Paginación controlada: page=1..MAX_PAGES
    const collected = [];
    let totalRead = 0;
    let reachedSyncPoint = false;

    for (let page = 1; page <= MAX_PAGES; page++) {
      pagesQueried = page;
      const moobizData = await fetchJsonOrThrow(
        `${MOOBIZ_LOGS_URL}?limit=${PAGE_SIZE}&page=${page}`,
        { headers: { Authorization: `Bearer ${MOOBIZ_LOGS_TOKEN}` } },
        `Fetch Moobiz page ${page}`
      );

      const items = moobizData.items || [];
      console.log(`[sync] page=${page} items=${items.length}`);
      totalRead += items.length;

      {
        const firstId = items.length > 0 ? String(items[0].id) : "—";
        const lastItemId = items.length > 0 ? String(items[items.length - 1].id) : "—";
        console.log(
          `[sync][debug] page=${page} PAGE_SIZE=${PAGE_SIZE} items.length=${items.length} first_id=${firstId} last_id=${lastItemId}`,
        );
      }

      if (page === 1 && items.length > 0) {
        const first10 = items.slice(0, 10).map((it) => it.id);
        console.log(
          `[sync][debug] page1 first_id=${items[0].id} last_id=${items[items.length - 1].id} first10_ids=${JSON.stringify(first10)}`,
        );
      }

      if (items.length === 0) {
        reachedSyncPoint = true;
        console.log("[sync][debug] fin por items.length === 0");
        break;
      }

      // Recorrer la página y recolectar solo id > lastId; si encontramos id <= lastId, hemos alcanzado punto
      for (const it of items) {
        const idBig = BigInt(it.id);
        if (idBig > lastId) {
          collected.push(it);
        } else {
          reachedSyncPoint = true;
          console.log(
            `[sync][debug] BREAK en page ${page} por id ${it.id} <= lastId ${lastId.toString()}`,
          );
        }
      }

      if (reachedSyncPoint) {
        if (items.length < PAGE_SIZE) {
          console.log("[sync][debug] fin por items.length < PAGE_SIZE");
        } else {
          console.log("[sync][debug] fin por reachedSyncPoint");
        }
        break;
      }

      // pequeña pausa entre páginas para ser amable con la API
      if (page < MAX_PAGES) await sleep(DELAY_MS);
    }

    if (!reachedSyncPoint) {
      console.log("[sync][debug] fin por MAX_PAGES");
    }

    console.log(`[sync] total leído (items): ${totalRead}`);
    console.log(`[sync] recolectados antes dedup: ${collected.length}`);

    // 3) Deduplicar por ID (porque la API puede solapar entre páginas)
    const uniqueMap = new Map();
    for (const it of collected) {
      const k = String(it.id);
      if (!uniqueMap.has(k)) uniqueMap.set(k, it);
    }
    const nuevos = Array.from(uniqueMap.values()).sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
    console.log(`[sync] nuevos deduplicados: ${nuevos.length}`);

    // 4) Insertar en lotes en Supabase (upsert)
    for (let i = 0; i < nuevos.length; i += SUPABASE_BATCH_SIZE) {
      const batch = nuevos.slice(i, i + SUPABASE_BATCH_SIZE);
      const payload = batch.map((it) => ({ original_id: String(it.id), raw: it }));
      await fetchJsonOrThrow(
        `${SUPABASE_URL}/rest/v1/moobiz_logs`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify(payload),
        },
        `Upsert moobiz_logs batch ${Math.floor(i / SUPABASE_BATCH_SIZE) + 1}`
      );
    }
    recordsInserted = nuevos.length;

    // 5) Actualizar sync_state.last_id al mayor id realmente insertado
    if (nuevos.length > 0) {
      const maxId = nuevos.reduce((max, it) => {
        const idB = BigInt(it.id);
        return idB > max ? idB : max;
      }, BigInt(lastIdAfter));
      await fetchJsonOrThrow(
        `${SUPABASE_URL}/rest/v1/sync_state`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({ key: "last_id", value: maxId.toString() }),
        },
        "Upsert sync_state"
      );
      lastIdAfter = maxId.toString();
      console.log(`[sync] sync_state actualizado a: ${lastIdAfter}`);
    } else {
      console.log("[sync] No hubo nuevos para actualizar sync_state.");
    }

    // Estado final
    status = reachedSyncPoint ? "success" : "warning_backlog";
    console.log(
      JSON.stringify({
        status,
        records_fetched: totalRead,
        records_inserted: recordsInserted,
        pages_queried: pagesQueried,
        last_id_after: lastIdAfter,
      })
    );
    console.log("✅ Sync completado");
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[sync] Error detectado:", errorMessage);
    // Re-throw para que GitHub Actions marque el job como failed si quieres
    throw err;
  } finally {
    // Siempre intentar registrar en public.sync_monitor (no debe abortar el flujo).
    await safeInsertSyncMonitor({
      status,
      records_inserted: recordsInserted,
      pages_queried: pagesQueried,
      last_id: lastIdAfter,
      error_message: errorMessage,
    });
  }
}

main().catch((err) => {
  console.error("❌ Ejecución terminada con error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});