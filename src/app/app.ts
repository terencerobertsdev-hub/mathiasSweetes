import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PointOfSale } from './pos/point-of-sale';
import { Admin } from './admin/admin';
import { GALLERY_ITEMS, INSTAGRAM_URL, WHATSAPP_URL } from './site-content';
import { SupabaseService } from './supabase.service';

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
  private readonly supabase = inject(SupabaseService).client;

  protected readonly isShopPage = this.document.location.pathname === '/shop';
  protected readonly isAdminPage = this.document.location.pathname.startsWith('/admin');
  protected readonly galleryItems = GALLERY_ITEMS;
  protected readonly instagramUrl = INSTAGRAM_URL;
  protected readonly whatsappUrl = WHATSAPP_URL;
  protected readonly currentYear = new Date().getFullYear();
  protected readonly orderStatus = signal<'idle' | 'sending' | 'success' | 'error'>('idle');
  protected readonly orderMessage = signal('');
  protected readonly newsletterStatus = signal<'idle' | 'sending' | 'success' | 'error'>('idle');
  protected readonly newsletterMessage = signal('');
  protected readonly mobileMenuOpen = signal(false);

  protected toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  protected closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  protected async subscribeToNewsletter(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const phone = String(data.get('phone') ?? '').trim();
    const smsConsent = data.get('smsConsent') === 'true';
    if (smsConsent && !phone) {
      this.newsletterStatus.set('error');
      this.newsletterMessage.set('Enter a phone number if you want text updates.');
      return;
    }
    this.newsletterStatus.set('sending');
    this.newsletterMessage.set('');
    const { error } = await this.supabase.rpc('subscribe_to_newsletter', {
      subscriber: { name: String(data.get('name')).trim(), email: String(data.get('email')).trim(), phone, sms_consent: smsConsent },
    });
    if (error) {
      this.newsletterStatus.set('error');
      this.newsletterMessage.set('We could not complete your signup. Please try again.');
      return;
    }
    form.reset();
    this.newsletterStatus.set('success');
    this.newsletterMessage.set('You’re on the treat list! Watch your inbox for weekly flavors and updates.');
  }

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
