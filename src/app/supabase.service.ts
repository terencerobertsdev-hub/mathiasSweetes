import { Injectable } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const SUPABASE_URL = 'https://sjkpanrzowucmxsvhdip.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_d7QViZoX3VZdn5q5DjLp0A_4u2E5rib';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { transport: (typeof globalThis.WebSocket === 'undefined' ? WebSocket : globalThis.WebSocket) as never },
  });
}
