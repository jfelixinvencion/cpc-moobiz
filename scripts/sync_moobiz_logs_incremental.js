const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MOOBIZ_LOGS_URL = process.env.MOOBIZ_LOGS_URL || 'https://app.moobiz.pe/api/admin/logs';
const MOOBIZ_LOGS_TOKEN = process.env.MOOBIZ_LOGS_TOKEN;

const LIMIT = 5000;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchLogs() {
  const url = `${MOOBIZ_LOGS_URL}?limit=${LIMIT}`;
  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${MOOBIZ_LOGS_TOKEN}`,
      Accept: 'application/json',
    },
  });
  return res.data.items || [];
}

async function getLastId() {
  const { data } = await supabase
    .from('sync_state')
    .select('value')
    .eq('key', 'last_id')
    .maybeSingle();

  return data ? BigInt(data.value) : 0n;
}

async function setLastId(id) {
  await supabase.from('sync_state').upsert({
    key: 'last_id',
    value: id.toString(),
  });
}

async function upsertLogs(items) {
  if (!items.length) return 0;

  const chunkSize = 500;
  let total = 0;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize).map(it => ({
      original_id: String(it.id),
      raw: it,
    }));

    const { error } = await supabase
      .from('moobiz_logs')
      .upsert(chunk, { onConflict: 'original_id' });

    if (error) throw error;

    total += chunk.length;
  }

  return total;
}

(async () => {
  try {
    console.log('Iniciando sync...');

    const lastId = await getLastId();
    console.log('last_id:', lastId.toString());

    const items = await fetchLogs();
    console.log('items recibidos:', items.length);

    let maxId = lastId;

    const nuevos = items.filter(it => {
      const id = BigInt(it.id);
      if (id > maxId) maxId = id;
      return id > lastId;
    });

    console.log('nuevos:', nuevos.length);

    await upsertLogs(nuevos);

    await setLastId(maxId);

    console.log('✅ Sync completado');
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
})();