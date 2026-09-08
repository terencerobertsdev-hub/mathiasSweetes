# Mathias Treats commerce operations

## Ownership and services

- Business organization: Canton Digital Works
- Website: `https://mathiastreats.com`
- Source repository: `terencerobertsdev-hub/mathiasSweetes`
- Production branch: `main`
- Database and authentication: Supabase project `sjkpanrzowucmxsvhdip`
- Stripe account displayed during setup: `FinixTechnocrats`

Do not store passwords, full bank details, Stripe secret keys, webhook secrets, customer records, or card information in this repository.

## Current product pricing

- One treat: $3.00
- Mix and match any four treats: $10.00
- The storefront displays the discount automatically.
- PostgreSQL recalculates the same discount when saving an order, so a browser cannot submit a forged total.

## Adding or changing website products

1. Sign in at `https://mathiastreats.com/admin` with an approved administrator account.
2. Add or edit the title, description, category, price, accessible picture description, and product image.
3. Save and verify the card on `https://mathiastreats.com/shop`.
4. Confirm the matching Stripe product and price before accepting payment for it.

Product images are stored in the Supabase `product-images` bucket. Product records are stored in the `public.products` table. Row-level security permits changes only for users listed in `public.admin_users`.

## Adding Mathias Treats products to Stripe

1. Sign in to the Stripe Dashboard using the authorized Canton Digital Works Stripe account.
2. Open **Product catalog** and choose **Add product**.
3. Prefix or clearly name the product `Mathias Treats - ...`.
4. Add metadata `site=mathias-treats` and the matching Supabase product ID.
5. Enter the price in US dollars and choose a one-time payment.
6. Keep Canton Digital Works service products separate; never reuse their price IDs for Mathias Treats.
7. Create checkout sessions on a trusted server. Never place the Stripe secret key in Angular.
8. Verify the signed Stripe webhook before marking an order paid. Store only provider IDs, status, amount, and receipt URL—never card data.
9. Complete a low-value Stripe test-mode transaction before enabling live payments.

## Where money goes

Stripe collects customer payment into the selected Stripe account balance. Stripe then sends payouts to the external bank account configured under **Settings > Bank accounts and scheduling** for that Stripe account.

The payout bank has not yet been verified for Mathias Treats. Verify the Stripe account name, legal entity, payout bank last four digits, payout schedule, currency, and tax responsibility with the business owner before enabling live checkout. Do not record full bank details here.

## Production readiness

- [x] Public storefront deployed
- [x] SQL product catalog connected
- [x] SQL order requests connected
- [x] Server-side order-price recalculation
- [x] Administrator authentication and row-level security
- [x] Product-image storage policies
- [ ] Stripe Mathias Treats products and prices created
- [ ] Server-side Stripe Checkout endpoint connected
- [ ] Signed, idempotent Stripe webhook connected
- [ ] Payout destination verified by the business owner
- [ ] Stripe test-mode purchase and refund completed
- [ ] Live payment confirmation completed with explicit authorization

Until every Stripe item above is complete, the site can accept order requests but must not be represented as accepting completed online card payments.
