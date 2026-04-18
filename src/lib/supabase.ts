// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Cliente con permisos de Service Role (solo usar server-side)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)