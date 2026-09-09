import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PointOfSale } from './pos/point-of-sale';
import { Admin } from './admin/admin';
import { GALLERY_ITEMS, INSTAGRAM_URL, WHATSAPP_URL } from './site-content';

@Component({
  selector: 'app-root',
  imports: [Admin, PointOfSale],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly orderEndpoint = 'https://formspree.io/f/mykovkdg';
  private readonly document = inject(DOCUMENT);

  protected readonly isShopPage = this.document.location.pathname === '/shop';
  protected readonly isAdminPage = this.document.location.pathname.startsWith('/admin');
  protected readonly galleryItems = GALLERY_ITEMS;
  protected readonly instagramUrl = INSTAGRAM_URL;
  protected readonly whatsappUrl = WHATSAPP_URL;
  protected readonly currentYear = new Date().getFullYear();
  protected readonly orderStatus = signal<'idle' | 'sending' | 'success' | 'error'>('idle');
  protected readonly orderMessage = signal('');

  protected async submitOrder(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;

    this.orderStatus.set('sending');
    this.orderMessage.set('');

    try {
      const response = await fetch(this.orderEndpoint, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) throw new Error('Order request was not accepted');

      form.reset();
      this.orderStatus.set('success');
      this.orderMessage.set('Your request was sent to Mathias’s parent or guardian. They’ll reply by email.');
    } catch {
      this.orderStatus.set('error');
      this.orderMessage.set('Your request could not be sent. Please wait a moment and try again.');
    }
  }
}
