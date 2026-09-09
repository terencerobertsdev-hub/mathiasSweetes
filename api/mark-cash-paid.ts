import Stripe from 'stripe';
import { json, requireAdmin } from './_lib/commerce.js';
import { notifyPaidOrder } from './_lib/notifications.js';

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return json({ error: 'Administrator authorization required.' }, 401);
    const { orderId } = await request.json() as { orderId?: string };
    if (!orderId || !ORDER_ID_PATTERN.test(orderId)) return json({ error: 'A valid order ID is required.' }, 400);
    const { data: order, error } = await admin.supabase.from('orders')
      .select('id,customer_name,customer_email,customer_phone,requested_date,subtotal_in_cents,status,payment_method,stripe_invoice_id,order_items(product_title,unit_price_in_cents,quantity)')
      .eq('id', orderId).single();
    if (error || !order) return json({ error: 'Order not found.' }, 404);
    if (order.payment_method !== 'cash') return json({ error: 'Only cash orders can be marked paid here.' }, 409);
    if (order.status === 'paid') return json({ invoiceId: order.stripe_invoice_id, alreadyPaid: true });
    const itemTotal = order.order_items.reduce((total, item) => total + item.unit_price_in_cents * item.quantity, 0);
    if (!order.order_items.length || itemTotal !== order.subtotal_in_cents) return json({ error: 'The saved cash total could not be verified.' }, 409);

    const stripeKey = process.env['STRIPE_SECRET_KEY'];
    if (!stripeKey) throw new Error('Stripe is not configured.');
    const stripe = new Stripe(stripeKey);
    const customer = await stripe.customers.create({ name: order.customer_name, email: order.customer_email, phone: order.customer_phone ?? undefined, metadata: { site: 'mathias-treats', order_id: order.id } }, { idempotencyKey: `mathias-cash-customer-${order.id}` });
    const invoice = await stripe.invoices.create({
      customer: customer.id, collection_method: 'send_invoice', days_until_due: 0, auto_advance: false,
      description: `Mathias Treats cash order ${order.id}`,
      footer: 'PAID WITH CASH. PICKUP: 113 McWhiter Pl, Canton, GA 30115. Your order will be in the outside pickup cart and labeled with the customer name.',
      custom_fields: [{ name: 'Payment method', value: 'Cash' }], metadata: { site: 'mathias-treats', order_id: order.id, payment_method: 'cash' },
    }, { idempotencyKey: `mathias-cash-invoice-${order.id}` });
    let currentInvoice = await stripe.invoices.retrieve(invoice.id);
    if (currentInvoice.status === 'draft') {
      for (const [index, item] of order.order_items.entries()) {
        await stripe.invoiceItems.create({ customer: customer.id, invoice: invoice.id, amount: item.unit_price_in_cents * item.quantity, currency: 'usd', description: `${item.quantity} × ${item.product_title}` }, { idempotencyKey: `mathias-cash-line-${order.id}-${index}` });
      }
      currentInvoice = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false }, { idempotencyKey: `mathias-cash-finalize-${order.id}` });
    }
    const paidInvoice = currentInvoice.status === 'paid' ? currentInvoice : await stripe.invoices.pay(invoice.id, { paid_out_of_band: true }, { idempotencyKey: `mathias-cash-paid-${order.id}` });
    await stripe.invoices.sendInvoice(invoice.id, {}, { idempotencyKey: `mathias-cash-email-${order.id}` });
    const { data: recorded, error: recordError } = await admin.supabase.rpc('record_cash_payment', { p_order_id: order.id, p_invoice_id: paidInvoice.id });
    if (recordError || !recorded) throw recordError ?? new Error('Cash payment was not recorded.');
    await notifyPaidOrder(order);
    return json({ invoiceId: paidInvoice.id, receiptUrl: paidInvoice.hosted_invoice_url });
  } catch (error) {
    console.error('Cash payment error', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'The cash payment could not be recorded. No Stripe charge was made.' }, 500);
  }
}
