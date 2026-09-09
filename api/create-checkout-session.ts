import Stripe from 'stripe';
import {
  getServerSupabase,
  json,
  SITE_URL,
} from './_lib/commerce.js';

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckoutItem = {
  product_title: string;
  unit_price_in_cents: number;
  quantity: number;
  special_id: number | null;
  stripe_price_id: string | null;
  specials: { title: string; qualifying_quantity: number; bundle_price_in_cents: number } | null;
};

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
        .select('id,status,payment_method,customer_email,subtotal_in_cents,stripe_checkout_session_id')
        .eq('id', orderId)
        .single(),
      supabase.from('order_items').select('product_title,unit_price_in_cents,quantity,special_id,stripe_price_id,specials(title,qualifying_quantity,bundle_price_in_cents)').eq('order_id', orderId),
    ]);

    if (orderError || itemsError || !order || !items?.length) {
      return json({ error: 'The order could not be found.' }, 404);
    }
    if (order.status === 'paid') {
      return json({ error: 'This order is already paid.' }, 409);
    }
    if (order.payment_method !== 'card') return json({ error: 'Cash orders do not use card checkout.' }, 409);

    const checkoutItems = items as unknown as CheckoutItem[];
    const itemCount = checkoutItems.reduce((total, item) => total + Number(item.quantity), 0);
    let expectedTotal = 0;
    const specialGroups = new Map<number, CheckoutItem[]>();
    for (const item of checkoutItems) {
      if (item.special_id && item.specials) {
        specialGroups.set(item.special_id, [...(specialGroups.get(item.special_id) ?? []), item]);
      } else {
        expectedTotal += item.quantity * item.unit_price_in_cents;
      }
    }
    for (const group of specialGroups.values()) {
      const special = group[0].specials!;
      const quantity = group.reduce((total, item) => total + item.quantity, 0);
      expectedTotal += Math.floor(quantity / special.qualifying_quantity) * special.bundle_price_in_cents;
      expectedTotal += (quantity % special.qualifying_quantity) * group[0].unit_price_in_cents;
    }
    if (itemCount < 1 || itemCount > 720 || expectedTotal !== order.subtotal_in_cents) {
      return json({ error: 'The saved order total could not be verified.' }, 409);
    }

    const stripe = new Stripe(stripeSecretKey);
    if (order.stripe_checkout_session_id) {
      const existing = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
      if (existing.status === 'open' && existing.url) return json({ url: existing.url });
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    for (const item of checkoutItems.filter((entry) => !entry.special_id)) {
      lineItems.push({ price_data: { currency: 'usd', unit_amount: item.unit_price_in_cents, product_data: { name: item.product_title, metadata: { site: 'mathias-treats' } } }, quantity: item.quantity });
    }
    for (const group of specialGroups.values()) {
      const special = group[0].specials!;
      const bundleCount = Math.floor(group.reduce((total, item) => total + item.quantity, 0) / special.qualifying_quantity);
      if (bundleCount > 0) {
        if (group[0].stripe_price_id) lineItems.push({ price: group[0].stripe_price_id, quantity: bundleCount });
        else lineItems.push({ price_data: { currency: 'usd', unit_amount: special.bundle_price_in_cents, product_data: { name: special.title, metadata: { site: 'mathias-treats' } } }, quantity: bundleCount });
      }

      let remaining = group.reduce((total, item) => total + item.quantity, 0) % special.qualifying_quantity;
      for (const item of group) {
        if (remaining === 0) break;
        const quantity = Math.min(remaining, item.quantity);
        lineItems.push({ price_data: { currency: 'usd', unit_amount: item.unit_price_in_cents, product_data: { name: item.product_title, metadata: { site: 'mathias-treats' } } }, quantity });
        remaining -= quantity;
      }
    }

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
          footer: 'PAID ORDER PICKUP: 113 McWhiter Pl, Canton, GA 30115. Your order will be in the outside pickup cart and labeled with the customer name. If using a delivery service, provide these details directly to the driver.',
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
