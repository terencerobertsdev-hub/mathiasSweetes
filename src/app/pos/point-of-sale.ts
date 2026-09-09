import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CartLine, Product } from './product.model';
import { ProductRepository } from './product-repository.service';
import { SupabaseService } from '../supabase.service';

type Special = { id: number; title: string; qualifying_quantity: number; qualifying_unit_price_in_cents: number; bundle_price_in_cents: number };

@Component({
  selector: 'app-point-of-sale',
  imports: [CurrencyPipe],
  templateUrl: './point-of-sale.html',
  styleUrl: './point-of-sale.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PointOfSale {
  private readonly productRepository = inject(ProductRepository);
  private readonly supabase = inject(SupabaseService).client;

  protected readonly products = this.productRepository.getProducts();
  protected readonly quantities = signal<Record<number, number>>({});
  protected readonly specialBundles = signal(0);
  protected readonly checkoutOpen = signal(false);
  protected readonly orderStatus = signal<'idle' | 'sending' | 'success' | 'error'>('idle');
  protected readonly orderMessage = signal('');
  protected readonly special = signal<Special | null>(null);

  constructor() { void this.loadSpecial(); }

  protected readonly cartLines = computed<CartLine[]>(() =>
    this.products()
      .map((product) => ({ product, quantity: this.quantities()[product.id] ?? 0 }))
      .filter((line) => line.quantity > 0),
  );
  protected readonly itemCount = computed(() => this.cartLines().reduce((total, line) => total + line.quantity, 0) + this.specialBundles() * (this.special()?.qualifying_quantity ?? 0));
  protected readonly regularSubtotalInCents = computed(() =>
    this.cartLines().reduce((total, line) => total + line.product.priceInCents * line.quantity, 0),
  );
  protected readonly subtotalInCents = computed(() => this.regularSubtotalInCents() + this.specialBundles() * (this.special()?.bundle_price_in_cents ?? 0));
  protected readonly orderSummary = computed(() => {
    const lines = this.cartLines().map((line) => `${line.quantity} × ${line.product.title} — ${this.formatCurrency(line.product.priceInCents * line.quantity)}`);
    const special = this.special();
    if (special && this.specialBundles()) lines.push(`${this.specialBundles() * special.qualifying_quantity} cake pops (${this.specialBundles()} × ${special.title}) — ${this.formatCurrency(this.specialBundles() * special.bundle_price_in_cents)}`);
    return lines.join('\n');
  });

  protected quantityFor(productId: number): number {
    return this.quantities()[productId] ?? 0;
  }

  protected changeQuantity(productId: number, change: number): void {
    const nextQuantity = Math.max(0, Math.min(24, this.quantityFor(productId) + change));
    this.quantities.update((current) => ({ ...current, [productId]: nextQuantity }));
    this.orderStatus.set('idle');
    this.orderMessage.set('');
  }

  protected setQuantity(productId: number, event: Event): void {
    const requestedQuantity = Number((event.target as HTMLInputElement).value);
    const nextQuantity = Number.isFinite(requestedQuantity) ? Math.max(0, Math.min(24, Math.floor(requestedQuantity))) : 0;
    this.quantities.update((current) => ({ ...current, [productId]: nextQuantity }));
  }

  protected removeLine(productId: number): void {
    this.quantities.update((current) => ({ ...current, [productId]: 0 }));
  }

  protected changeSpecialBundles(change: number): void { this.specialBundles.set(Math.max(0, Math.min(24, this.specialBundles() + change))); }

  protected setSpecialQuantity(event: Event): void {
    const special = this.special();
    if (!special) return;
    const treats = Math.max(0, Number((event.target as HTMLInputElement).value) || 0);
    this.specialBundles.set(Math.min(24, Math.floor(treats / special.qualifying_quantity)));
  }

  protected openCheckout(): void {
    if (this.itemCount() === 0) {
      this.orderStatus.set('error');
      this.orderMessage.set('Choose at least one treat before checking out.');
      return;
    }

    this.checkoutOpen.set(true);
    this.orderMessage.set('');
  }

  protected closeCheckout(): void {
    this.checkoutOpen.set(false);
  }

  protected async submitOrder(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;

    if (this.itemCount() === 0) {
      this.closeCheckout();
      this.orderStatus.set('error');
      this.orderMessage.set('Your cart is empty. Add a treat to continue.');
      return;
    }

    if (!form.reportValidity()) return;

    this.orderStatus.set('sending');
    this.orderMessage.set('');
    const formData = new FormData(form);

    try {
      const { data: orderId, error } = await this.supabase.rpc('place_order', {
        customer: { name: String(formData.get('name')), email: String(formData.get('email')), phone: String(formData.get('phone') ?? ''), requested_date: String(formData.get('requestedDate') ?? ''), notes: String(formData.get('notes') ?? ''), pickup_acknowledged: formData.get('pickupAcknowledged') === 'true', payment_method: String(formData.get('paymentMethod')) },
        items: [...this.cartLines().map((line) => ({ product_id: line.product.id, quantity: line.quantity })), ...(this.special() && this.specialBundles() ? [{ special_id: this.special()!.id, quantity: this.specialBundles() }] : [])],
      });
      if (error) throw error;

      if (formData.get('paymentMethod') === 'cash') {
        form.reset();
        this.quantities.set({});
        this.specialBundles.set(0);
        this.checkoutOpen.set(false);
        this.orderStatus.set('success');
        this.orderMessage.set('Your cash order is reserved. An adult will contact you to arrange payment and pickup. The address is released after the cash is received.');
        return;
      }

      const checkoutResponse = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const checkout = await checkoutResponse.json() as { url?: string; error?: string };
      if (!checkoutResponse.ok || !checkout.url) throw new Error(checkout.error ?? 'Checkout unavailable');

      form.reset();
      this.quantities.set({});
      this.specialBundles.set(0);
      window.location.assign(checkout.url);
    } catch {
      this.orderStatus.set('error');
      this.orderMessage.set('The order could not be placed. No payment was taken and your cart is still here—please try again.');
    }
  }

  private formatCurrency(priceInCents: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(priceInCents / 100);
  }

  private async loadSpecial(): Promise<void> {
    const { data } = await this.supabase.from('specials').select('id,title,qualifying_quantity,qualifying_unit_price_in_cents,bundle_price_in_cents').eq('is_active', true).maybeSingle();
    if (data) this.special.set(data as Special);
  }
}
