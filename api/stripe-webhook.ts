import Stripe from 'stripe';
import { getServerSupabase, json } from './_lib/commerce.js';
import { notifyPaidOrder } from './_lib/notifications.js';

const SUPPORTED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);

export async function POST(request: Request): Promise<Response> {
  const stripeSecretKey = process.env['STRIPE_SECRET_KEY'];
  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!stripeSecretKey || !webhookSecret) return json({ error: 'Webhook is not configured.' }, 503);

  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ error: 'Missing Stripe signature.' }, 400);

  const stripe = new Stripe(stripeSecretKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch {
    return json({ error: 'Invalid Stripe signature.' }, 400);
  }

  if (!SUPPORTED_EVENTS.has(event.type)) return json({ received: true });
  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.metadata?.['order_id'] ?? session.client_reference_id;
  if (!orderId || session.metadata?.['site'] !== 'mathias-treats') {
    return json({ error: 'Stripe event is missing Mathias Treats order metadata.' }, 400);
  }

  const paymentStatus = event.type === 'checkout.session.async_payment_failed'
    ? 'failed'
    : session.payment_status;
  const supabase = getServerSupabase();
  const { data: recorded, error } = await supabase.rpc('record_stripe_payment', {
    p_event_id: event.id,
    p_order_id: orderId,
    p_checkout_session_id: session.id,
    p_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    p_payment_status: paymentStatus,
    p_amount_total: session.amount_total ?? 0,
  });

  if (error) {
    console.error('Stripe webhook database error', error.message);
    return json({ error: 'The payment event could not be recorded.' }, 500);
  }
  if (recorded && paymentStatus === 'paid') {
    const { data: order } = await supabase
      .from('orders')
      .select('id,customer_name,customer_email,customer_phone,requested_date,subtotal_in_cents')
      .eq('id', orderId)
      .single();
    if (order) await notifyPaidOrder(order);
  }
  return json({ received: true });
}
