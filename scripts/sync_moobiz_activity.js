require('dotenv').config();
const axios = require('axios');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MOOBIZ_API_URL = process.env.MOOBIZ_API_URL;
const MOOBIZ_API_AUTH_METHOD = (process.env.MOOBIZ_API_AUTH_METHOD || 'bearer').toLowerCase();

const MOOBIZ_TOKEN = process.env.MOOBIZ_TOKEN;
const MOOBIZ_PHPSESSID = process.env.MOOBIZ_PHPSESSID;
const MOOBIZ_ZLDP = process.env.MOOBIZ_ZLDP;
const MOOBIZ_ZLDT = process.env.MOOBIZ_ZLDT;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan variables de Supabase: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!MOOBIZ_API_URL) {
  console.error('Falta MOOBIZ_API_URL');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function normalizeHeader(h) {
  if (!h) return null;
  return h
    .toString()
    .trim()
    .normalize('NFKD')
    .replace(/[^\w\s\-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase();
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildCookieHeader() {
  let cookie = '';
  if (MOOBIZ_PHPSESSID) cookie += `PHPSESSID=${MOOBIZ_PHPSESSID}; `;
  if (MOOBIZ_ZLDP) cookie += `zldp=${MOOBIZ_ZLDP}; `;
  if (MOOBIZ_ZLDT) cookie += `zldt=${MOOBIZ_ZLDT}; `;
  return cookie.trim();
}

async function downloadXlsxBuffer() {
  const body = new URLSearchParams();
  body.append('export', 'xlsx');

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (MOOBIZ_API_AUTH_METHOD === 'bearer') {
    if (!MOOBIZ_TOKEN) {
      throw new Error('MOOBIZ_API_AUTH_METHOD=bearer pero falta MOOBIZ_TOKEN');
    }
    headers.Authorization = `Bearer ${MOOBIZ_TOKEN}`;
  } else if (MOOBIZ_API_AUTH_METHOD === 'cookie') {
    const cookie = buildCookieHeader();
    if (!cookie) {
      throw new Error('MOOBIZ_API_AUTH_METHOD=cookie pero faltan cookies');
    }
    headers.Cookie = cookie;
  } else {
    throw new Error('MOOBIZ_API_AUTH_METHOD debe ser bearer o cookie');
  }

  const resp = await axios.post(MOOBIZ_API_URL, body.toString(), {
    responseType: 'arraybuffer',
    headers,
    timeout: 60000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  return Buffer.from(resp.data);
}

function parseXlsxBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: false,
  });

  return rows.map((row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[normalizeHeader(key)] = value;
    }
    return normalized;
  });
}

function mapRowToDb(row) {
  const datosRaw = row['datos'] ?? null;
  let datos = null;

  if (datosRaw) {
    try {
      if (typeof datosRaw === 'object') {
        datos = datosRaw;
      } else {
        datos = JSON.parse(datosRaw);
      }
    } catch {
      datos = { raw: String(datosRaw) };
    }
  }

  return {
    id: toNumber(row['id']),
    fecha: parseDate(row['fecha']),
    tipo_actividad: row['tipo_actividad'] ?? row['tipo actividad'] ?? null,
    id_tipo: toNumber(row['id_tipo'] ?? row['id tipo']),
    id_usuario: toNumber(row['id_usuario'] ?? row['id usuario']),
    nombre_usuario: row['nombre_usuario'] ?? row['nombre usuario'] ?? null,
    apellido_usuario: row['apellido_usuario'] ?? row['apellido usuario'] ?? null,
    tipo_usuario: row['tipo_usuario'] ?? row['tipo usuario'] ?? null,
    plataforma: row['plataforma'] ?? null,
    tabla_destino: row['tabla_destino'] ?? row['tabla destino'] ?? null,
    id_destino: toNumber(row['id_destino'] ?? row['id destino']),
    tabla_padre: row['tabla_padre'] ?? row['tabla padre'] ?? null,
    id_padre: toNumber(row['id_padre'] ?? row['id padre']),
    datos,
  };
}

async function upsertRows(rows) {
  const validRows = rows.filter((r) => r.id !== null && r.id !== undefined);

  if (validRows.length === 0) {
    throw new Error('No se encontraron filas válidas con ID');
  }

  const { error } = await supabase
    .from('moobiz_actividad')
    .upsert(validRows, { onConflict: 'id' });

  if (error) {
    throw error;
  }
}

async function main() {
  console.log('Descargando XLSX desde Moobiz...');
  const buffer = await downloadXlsxBuffer();

  console.log('Parseando XLSX...');
  const rows = parseXlsxBuffer(buffer);
  console.log(`Filas encontradas: ${rows.length}`);

  console.log('Mapeando filas...');
  const mappedRows = rows.map(mapRowToDb);

  console.log('Guardando en Supabase...');
  await upsertRows(mappedRows);

  console.log('Listo. Datos guardados correctamente en moobiz_actividad.');
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});