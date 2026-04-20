// (parche ligero sobre tu versión)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOOBIZ_LOGS_TOKEN = process.env.MOOBIZ_LOGS_TOKEN;
const MOOBIZ_LOGS_URL = "https://app.moobiz.pe/api/admin/logs";
const PAGE_SIZE = 1000; // recomendado en producción
const MAX_PAGES = 10;
const DELAY_MS = 300;
const SUPABASE_BATCH_SIZE = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonOrThrow(url, options, label) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`${label} failed (${res.status}): ${await res.text()}`);
  }
  const raw = await res.text();
  return raw ? JSON.parse(raw) : null;
}

async function sync() {
  console.log("Iniciando sync en GitHub...");
  let status = "success";
  let recordsInserted = 0;
  let pagesQueried = 0;
  let lastIdAfter = 0n;
  let errorMessage = null;

  try {
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
    lastIdAfter = lastId;
    console.log(`[sync] last_id inicial: ${lastId.toString()}`);

    let totalRead = 0;
    let lastPageQueried = 0;
    let reachedSyncPoint = false;
    const collected = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      lastPageQueried = page;
      const moobizData = await fetchJsonOrThrow(
        `${MOOBIZ_LOGS_URL}?limit=${PAGE_SIZE}&page=${page}`,
        {
          headers: { Authorization: `Bearer ${MOOBIZ_LOGS_TOKEN}` },
        },
        `Fetch Moobiz page ${page}`
      );

      const items = moobizData.items || [];
      totalRead += items.length;
      console.log(`[sync] pagina=${page} items=${items.length}`);

      if (items.length === 0) {
        reachedSyncPoint = true;
        break;
      }

      // Chequeo rápido: si el primer id ya está por detrás del cursor, salgo
      if (BigInt(items[0].id) <= lastId) {
        reachedSyncPoint = true;
        console.log(`[sync][debug] primera fila page ${page} (${items[0].id}) <= lastId ${lastId.toString()} — fin temprano`);
        break;
      }

      // Conserva nuevos y corta cuando detecta IDs ya sincronizados dentro de la página.
      for (const it of items) {
        const id = BigInt(it.id);
        if (id > lastId) {
          collected.push(it);
        } else {
          reachedSyncPoint = true;
          break; // romper la iteración de la página inmediatamente
        }
      }

      if (reachedSyncPoint) {
        break;
      }

      if (page < MAX_PAGES) {
        await sleep(DELAY_MS);
      }
    }
    pagesQueried = lastPageQueried;

    // Deduplicación por ID
    const uniqueById = new Map();
    for (const item of collected) {
      const key = String(item.id);
      if (!uniqueById.has(key)) {
        uniqueById.set(key, item);
      }
    }
    const nuevos = Array.from(uniqueById.values());
    recordsInserted = nuevos.length;
    console.log(`[sync] nuevos deduplicados: ${nuevos.length}`);

    // Insertar en lotes
    for (let i = 0; i < nuevos.length; i += SUPABASE_BATCH_SIZE) {
      const batch = nuevos.slice(i, i + SUPABASE_BATCH_SIZE);
      const toInsert = batch.map((it) => ({ original_id: String(it.id), raw: it }));
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
          body: JSON.stringify(toInsert),
        },
        `Upsert moobiz_logs batch ${Math.floor(i / SUPABASE_BATCH_SIZE) + 1}`
      );
    }

    // Actualizar Last ID si hubo nuevos
    if (nuevos.length > 0) {
      const maxId = nuevos.reduce(
        (max, it) => (BigInt(it.id) > max ? BigInt(it.id) : max),
        lastId
      );
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
      lastIdAfter = maxId;
    }

    status = reachedSyncPoint ? "success" : "warning_backlog";

    console.log(`[sync] paginas consultadas: ${lastPageQueried}`);
    console.log(`[sync] total insertados: ${nuevos.length}`);
    console.log(`[sync] last_id final: ${lastIdAfter.toString()}`);
    console.log(
        JSON.stringify({
          status,
          records_fetched: totalRead,
          records_inserted: nuevos.length,
          pages_queried: pagesQueried,
          last_id_after: lastIdAfter.toString(),
        })
      );
    console.log("✅ Sync completado con éxito");
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // Enviar sync_monitor sin tirar excepción que oculte el error original
    try {
      await fetchJsonOrThrow(
        `${SUPABASE_URL}/rest/v1/sync_monitor`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status,
            records_inserted: recordsInserted,
            pages_queried: pagesQueried,
            last_id: lastIdAfter.toString(),
            error_message: errorMessage,
          }),
        },
        "Insert sync_monitor"
      );
    } catch (e) {
      console.error("[sync] sync_monitor insert falló:", e instanceof Error ? e.message : String(e));
    }
  }
}

sync().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});