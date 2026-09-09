import Stripe from 'stripe';
import {
  calculateTotal,
  FOUR_TREAT_PRICE_ID,
  getServerSupabase,
  json,
  SINGLE_TREAT_PRICE_ID,
  SITE_URL,
} from './_lib/commerce.js';

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return json({ error: 'Expected a JSON request.' }, 415);
    }

    const body = await request.json() as { orderId?: unknown };
    const orderId = typeof body.orderId === 'string' ? body.orderId : '';
    if (!ORDER_ID_PATTERN.test(orderId)) {
      return json({ error: 'A valid order ID is required.' }, 400);
    }

    const stripeSecretKey = process.env['STRIPE_SECRET_KEY'];
    if (!stripeSecretKey) throw new Error('Stripe server environment is not configured.');

    const supabase = getServerSupabase();
    const [{ data: order, error: orderError }, { data: items, error: itemsError }] = await Promise.all([
      supabase
        .from('orders')
        .select('id,status,customer_email,subtotal_in_cents,stripe_checkout_session_id')
        .eq('id', orderId)
        .single(),
      supabase.from('order_items').select('quantity').eq('order_id', orderId),
    ]);

    if (orderError || itemsError || !order || !items?.length) {
      return json({ error: 'The order could not be found.' }, 404);
    }
    if (order.status === 'paid') {
      return json({ error: 'This order is already paid.' }, 409);
    }

    const itemCount = items.reduce((total, item) => total + Number(item.quantity), 0);
    const expectedTotal = calculateTotal(itemCount);
    if (itemCount < 1 || itemCount > 720 || expectedTotal !== order.subtotal_in_cents) {
      return json({ error: 'The saved order total could not be verified.' }, 409);
    }

    const stripe = new Stripe(stripeSecretKey);
    if (order.stripe_checkout_session_id) {
      const existing = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
      if (existing.status === 'open' && existing.url) return json({ url: existing.url });
    }

    const bundleQuantity = Math.floor(itemCount / 4);
    const singleQuantity = itemCount % 4;
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    if (bundleQuantity) lineItems.push({ price: FOUR_TREAT_PRICE_ID, quantity: bundleQuantity });
    if (singleQuantity) lineItems.push({ price: SINGLE_TREAT_PRICE_ID, quantity: singleQuantity });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      client_reference_id: order.id,
      customer_email: order.customer_email,
      success_url: `${SITE_URL}/shop?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/shop?payment=cancelled`,
      metadata: { site: 'mathias-treats', order_id: order.id },
      payment_intent_data: { metadata: { site: 'mathias-treats', order_id: order.id } },
      custom_text: {
        submit: { message: 'Local pickup in Canton, Georgia. The exact address is provided after payment and adult confirmation of the pickup time.' },
      },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `Mathias Treats local pickup order ${order.id}`,
          footer: 'Local pickup in Canton, Georgia. The exact address is provided separately after payment and adult confirmation of the pickup time.',
          metadata: { site: 'mathias-treats', order_id: order.id },
        },
      },
      submit_type: 'pay',
    }, { idempotencyKey: `mathias-order-${order.id}` });

    const { error: updateError } = await supabase
      .from('orders')
      .update({ stripe_checkout_session_id: session.id, payment_status: session.payment_status })
      .eq('id', order.id);
    if (updateError) throw updateError;
    if (!session.url) throw new Error('Stripe did not return a Checkout URL.');

    return json({ url: session.url });
  } catch (error) {
    console.error('Checkout session error', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'Secure checkout is temporarily unavailable. No payment was taken.' }, 500);
  }
}
