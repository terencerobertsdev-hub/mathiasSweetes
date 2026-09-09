import { getServerSupabase, json } from './_lib/commerce.js';
import { sendPickupAddress } from './_lib/notifications.js';

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  try {
    const authorization = request.headers.get('authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return json({ error: 'Administrator sign-in is required.' }, 401);

    const body = await request.json() as { orderId?: unknown; pickupTime?: unknown };
    const orderId = typeof body.orderId === 'string' ? body.orderId : '';
    const pickupTime = typeof body.pickupTime === 'string' ? body.pickupTime.trim() : '';
    if (!ORDER_ID_PATTERN.test(orderId) || pickupTime.length < 5 || pickupTime.length > 100) {
      return json({ error: 'A valid order and pickup time are required.' }, 400);
    }

    const supabase = getServerSupabase();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return json({ error: 'Administrator session is invalid.' }, 401);
    const { data: admin } = await supabase.from('admin_users').select('user_id').eq('user_id', userData.user.id).maybeSingle();
    if (!admin) return json({ error: 'Administrator permission is required.' }, 403);

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id,customer_name,customer_email,customer_phone,requested_date,subtotal_in_cents,status,address_released_at')
      .eq('id', orderId)
      .single();
    if (orderError || !order) return json({ error: 'Order was not found.' }, 404);
    if (order.status !== 'paid') return json({ error: 'Only paid orders can release pickup details.' }, 409);
    if (order.address_released_at) return json({ error: 'Pickup details were already released.' }, 409);

    await sendPickupAddress(order, pickupTime);
    const { error: approvalError } = await supabase.rpc('approve_pickup_release', {
      p_order_id: orderId,
      p_admin_user_id: userData.user.id,
      p_pickup_time: pickupTime,
    });
    if (approvalError) throw approvalError;
    return json({ approved: true });
  } catch (error) {
    console.error('Pickup approval error', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'Pickup approval could not be completed. The address was not released.' }, 500);
  }
}
