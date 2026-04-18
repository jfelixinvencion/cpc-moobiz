import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import * as XLSX from 'xlsx'

export async function GET() {
  try {
    const headers = {
      'Authorization': 'Bearer ' + process.env.MOOBIZ_TOKEN,
      'Cookie': 'PHPSESSID=' + process.env.MOOBIZ_PHPSESSID
    }

    const body = new URLSearchParams();
    body.set('export', 'xlsx');

    const res = await fetch('https://app.moobiz.pe/api/admin/dispatcher', {
      method: 'POST',
      headers,
      body
    });

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

    // Mapeo inteligente con los nombres de columnas que vimos en tu captura
    const payloads = rows.map((r: any) => ({
      source_id: String(r.ID),
      source_date: r.Fecha ? new Date(r.Fecha).toISOString() : null,
      tipo_actividad: r.Estado || 'Reserva Activa',
      nombre_usuario: r.Usuario || null,
      apellido_usuario: r.Conductor || null, // Guardamos conductor aquí por ahora
      plataforma: r.Empresa || null,
      id_destino: r.Destino || null,
      tabla_padre: r.Origen || null,
      datos: r // Guardamos TODA la fila completa por si acaso
    }));

    // El famoso "UPSERT": si el ID ya existe, lo actualiza. Si no, lo crea.
    const { data, error } = await supabaseAdmin
      .from('moobiz_activity_raw')
      .upsert(payloads, { onConflict: 'source_id' });

    if (error) throw error;

    return NextResponse.json({ 
      ok: true, 
      mensaje: 'Sincronización exitosa', 
      filas_procesadas: payloads.length 
    });

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
