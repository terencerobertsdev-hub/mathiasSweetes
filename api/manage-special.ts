import Stripe from 'stripe';
import { json, requireAdmin } from './_lib/commerce.js';

export async function POST(request: Request): Promise<Response> {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return json({ error: 'Administrator authorization required.' }, 401);
    const body = await request.json() as Record<string, unknown>;
    const title = String(body['title'] ?? '').trim();
    const quantity = Number(body['quantity']);
    const unitPriceInCents = Number(body['unitPriceInCents']);
    const bundlePriceInCents = Number(body['bundlePriceInCents']);
    const isActive = body['isActive'] !== false;
    if (title.length < 3 || title.length > 80 || !Number.isInteger(quantity) || quantity < 2 || quantity > 100 ||
      !Number.isInteger(unitPriceInCents) || unitPriceInCents < 1 || !Number.isInteger(bundlePriceInCents) ||
      bundlePriceInCents < 1 || bundlePriceInCents >= quantity * unitPriceInCents) {
      return json({ error: 'Enter a valid special that costs less than the regular total.' }, 400);
    }

    const stripeKey = process.env['STRIPE_SECRET_KEY'];
    if (!stripeKey) throw new Error('Stripe is not configured.');
    const stripe = new Stripe(stripeKey);
    const { data: current } = await admin.supabase.from('specials').select('*').eq('is_active', true).maybeSingle();
    if (!isActive) {
      if (current?.stripe_price_id) await stripe.prices.update(current.stripe_price_id, { active: false });
      const { data: saved, error } = current
        ? await admin.supabase.from('specials').update({ title, qualifying_quantity: quantity, qualifying_unit_price_in_cents: unitPriceInCents, bundle_price_in_cents: bundlePriceInCents, is_active: false, updated_at: new Date().toISOString() }).eq('id', current.id).select().single()
        : await admin.supabase.from('specials').insert({ title, qualifying_quantity: quantity, qualifying_unit_price_in_cents: unitPriceInCents, bundle_price_in_cents: bundlePriceInCents, is_active: false }).select().single();
      if (error) throw error;
      return json({ special: saved });
    }
    let productId = current?.stripe_product_id as string | undefined;
    if (!productId) {
      const product = await stripe.products.create({ name: 'Mathias Treats specials', metadata: { site: 'mathias-treats' } });
      productId = product.id;
    }
    const price = await stripe.prices.create({
      product: productId,
      currency: 'usd',
      unit_amount: bundlePriceInCents,
      nickname: title,
      metadata: { site: 'mathias-treats', qualifying_quantity: String(quantity), qualifying_unit_price_in_cents: String(unitPriceInCents) },
    });
    if (current?.stripe_price_id && current.stripe_price_id !== price.id) {
      await stripe.prices.update(current.stripe_price_id, { active: false });
    }
    await admin.supabase.from('specials').update({ is_active: false, updated_at: new Date().toISOString() }).eq('is_active', true);
    const { data: saved, error } = await admin.supabase.from('specials').insert({
      title, qualifying_quantity: quantity, qualifying_unit_price_in_cents: unitPriceInCents,
      bundle_price_in_cents: bundlePriceInCents, stripe_product_id: productId, stripe_price_id: price.id, is_active: isActive,
    }).select().single();
    if (error) throw error;
    return json({ special: saved });
  } catch (error) {
    console.error('Special management error', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'The special could not be saved.' }, 500);
  }
}
