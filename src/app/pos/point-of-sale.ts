import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CartLine, Product } from './product.model';
import { ProductRepository } from './product-repository.service';
import { SupabaseService } from '../supabase.service';

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
  protected readonly checkoutOpen = signal(false);
  protected readonly orderStatus = signal<'idle' | 'sending' | 'success' | 'error'>('idle');
  protected readonly orderMessage = signal('');

  protected readonly cartLines = computed<CartLine[]>(() =>
    this.products()
      .map((product) => ({ product, quantity: this.quantities()[product.id] ?? 0 }))
      .filter((line) => line.quantity > 0),
  );
  protected readonly itemCount = computed(() =>
    this.cartLines().reduce((total, line) => total + line.quantity, 0),
  );
  protected readonly regularSubtotalInCents = computed(() =>
    this.cartLines().reduce((total, line) => total + line.product.priceInCents * line.quantity, 0),
  );
  protected readonly subtotalInCents = computed(() =>
    Math.floor(this.itemCount() / 4) * 1000 + (this.itemCount() % 4) * 300,
  );
  protected readonly bundleSavingsInCents = computed(() =>
    Math.max(0, this.regularSubtotalInCents() - this.subtotalInCents()),
  );
  protected readonly orderSummary = computed(() =>
    this.cartLines()
      .map((line) => `${line.quantity} × ${line.product.title} — ${this.formatCurrency(line.product.priceInCents * line.quantity)}`)
      .join('\n'),
  );

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
        customer: { name: String(formData.get('name')), email: String(formData.get('email')), phone: String(formData.get('phone') ?? ''), requested_date: String(formData.get('requestedDate') ?? ''), notes: String(formData.get('notes') ?? '') },
        items: this.cartLines().map((line) => ({ product_id: line.product.id, quantity: line.quantity })),
      });
      if (error) throw error;

      const checkoutResponse = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const checkout = await checkoutResponse.json() as { url?: string; error?: string };
      if (!checkoutResponse.ok || !checkout.url) throw new Error(checkout.error ?? 'Checkout unavailable');

      form.reset();
      this.quantities.set({});
      window.location.assign(checkout.url);
    } catch {
      this.orderStatus.set('error');
      this.orderMessage.set('Secure checkout is temporarily unavailable. No payment was taken and your cart is still here—please try again.');
    }
  }

  private formatCurrency(priceInCents: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(priceInCents / 100);
  }
}
