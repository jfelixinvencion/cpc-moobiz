export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

const MOOBIZ_EXPORT_URL = 'https://app.moobiz.pe/api/admin/dispatcher'

function buildCookieHeader() {
  const cookies: string[] = []
  if (process.env.MOOBIZ_PHPSESSID) cookies.push('PHPSESSID=' + process.env.MOOBIZ_PHPSESSID)
  else if (process.env.MOOBIZ_SESSION_COOKIE) cookies.push('PHPSESSID=' + process.env.MOOBIZ_SESSION_COOKIE)
  if (process.env.MOOBIZ_ZLDP) cookies.push('ZLDP=' + decodeURIComponent(process.env.MOOBIZ_ZLDP))
  if (process.env.MOOBIZ_ZLDT) cookies.push('ZLDT=' + process.env.MOOBIZ_ZLDT)
  return cookies.join('; ')
}

export async function GET() {
  try {
    const headers = {
      'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
      'Origin': 'https://app.moobiz.pe',
      'Referer': 'https://app.moobiz.pe/actives',
      'X-Requested-With': 'XMLHttpRequest',
      'Authorization': process.env.MOOBIZ_TOKEN ? 'Bearer ' + process.env.MOOBIZ_TOKEN : ''
    }

    const cookieHeader = buildCookieHeader()
    if (cookieHeader) headers['Cookie'] = cookieHeader

    const body = new URLSearchParams()
    body.set('export', 'xlsx')

    const response = await fetch(MOOBIZ_EXPORT_URL, {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json({ ok: false, status: response.status, errorText }, { status: 500 })
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null })

    return NextResponse.json({
      ok: true,
      rows: rows.length,
      firstRow: rows[0] ?? null,
      headers: rows[0] ? Object.keys(rows[0]) : [],
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
