const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOOBIZ_LOGS_TOKEN = process.env.MOOBIZ_LOGS_TOKEN;
const MOOBIZ_LOGS_URL = "https://app.moobiz.pe/api/admin/logs";
const LIMIT = 5000;

async function sync() {
  console.log("Iniciando sync en GitHub...");
  
  // 1. Obtener último ID de Supabase
  const lastIdRes = await fetch(`${SUPABASE_URL}/rest/v1/sync_state?key=eq.last_id&select=value`, {
    headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const lastIdData = await lastIdRes.json();
  const lastId = lastIdData.length ? BigInt(lastIdData[0].value) : 0n;
  console.log("Last ID en Supabase:", lastId.toString());

  // 2. Obtener logs de Moobiz
  const moobizRes = await fetch(`${MOOBIZ_LOGS_URL}?limit=${LIMIT}`, {
    headers: { 'Authorization': `Bearer ${MOOBIZ_LOGS_TOKEN}` }
  });
  const moobizData = await moobizRes.json();
  const items = moobizData.items || [];
  console.log("Items recibidos de Moobiz:", items.length);

  // 3. Filtrar nuevos
  const nuevos = items.filter(it => BigInt(it.id) > lastId);
  console.log("Nuevos detectados:", nuevos.length);

  if (nuevos.length > 0) {
    // 4. Upsert a Supabase
    const toInsert = nuevos.map(it => ({ original_id: String(it.id), raw: it }));
    await fetch(`${SUPABASE_URL}/rest/v1/moobiz_logs`, {
      method: 'POST',
      headers: { 
        'apikey': SUPABASE_SERVICE_ROLE_KEY, 
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(toInsert)
    });

    // 5. Actualizar Last ID
    const maxId = nuevos.reduce((max, it) => BigInt(it.id) > max ? BigInt(it.id) : max, lastId);
    await fetch(`${SUPABASE_URL}/rest/v1/sync_state?key=eq.last_id`, {
      method: 'POST',
      headers: { 
        'apikey': SUPABASE_SERVICE_ROLE_KEY, 
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ key: 'last_id', value: maxId.toString() })
    });
  }

  console.log("✅ Sync completado con éxito");
}

sync().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});