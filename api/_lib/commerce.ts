import { createClient } from '@supabase/supabase-js';

export const SITE_URL = process.env['SITE_URL'] ?? 'https://mathiastreats.com';
export const SINGLE_TREAT_PRICE_ID = 'price_1UDYpEHSSkrw4MjNwflBuWWS';
export const FOUR_TREAT_PRICE_ID = 'price_1UDYphHSSkrw4MjNQkhoiT7A';

export function getServerSupabase() {
  const url = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase server environment is not configured.');
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function calculateTotal(itemCount: number): number {
  return Math.floor(itemCount / 4) * 1000 + (itemCount % 4) * 300;
}
