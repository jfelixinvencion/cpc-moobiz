import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.from('moobiz_activity_raw').select('id').limit(1)
    if (error) throw error
    return NextResponse.json({ ok: true, sample: data ?? [] })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
  }
}
