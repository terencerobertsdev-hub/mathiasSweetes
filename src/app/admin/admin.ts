import { CurrencyPipe, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Product } from '../pos/product.model';
import { ProductRepository } from '../pos/product-repository.service';
import { SupabaseService } from '../supabase.service';

const ADMIN_RECOVERY_URL = 'https://mathiastreats.com/admin/reset-password';

type AdminOrder = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  requested_date: string | null;
  notes: string | null;
  subtotal_in_cents: number;
  payment_method: 'card' | 'cash';
  stripe_invoice_id: string | null;
  status: string;
  paid_at: string | null;
  pickup_time_confirmed: string | null;
  address_released_at: string | null;
  order_items: { product_title: string; quantity: number; unit_price_in_cents: number }[];
};
type Special = { title: string; qualifying_quantity: number; qualifying_unit_price_in_cents: number; bundle_price_in_cents: number; is_active: boolean };
@Component({
  selector: 'app-admin',
  imports: [CurrencyPipe],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Admin {
  private readonly productRepository = inject(ProductRepository);
  private readonly supabase = inject(SupabaseService).client;
  private readonly document = inject(DOCUMENT);

  protected readonly products = this.productRepository.getProducts();
  protected readonly orders = signal<AdminOrder[]>([]);
  protected readonly ordersLoading = signal(false);
  protected readonly special = signal<Special | null>(null);
  protected readonly specialSaving = signal(false);
  protected readonly editingId = signal<number | null>(null);
  protected readonly imagePreview = signal('');
  protected readonly message = signal(
    new URLSearchParams(this.document.location.search).get('password') === 'changed'
      ? 'Your password has been changed. Sign in with your new password.'
      : '',
  );
  protected readonly signedIn = signal(false);
  protected readonly recoveryMode = signal(this.document.location.pathname === '/admin/reset-password');
  protected readonly passwordResetStatus = signal<'idle' | 'sending'>('idle');
  private selectedImage: File | null = null;

  constructor() {
    void this.supabase.auth.getSession().then(({ data }) => {
      this.signedIn.set(Boolean(data.session));
      if (data.session) { void this.loadOrders(); void this.loadSpecial(); }
    });
    this.supabase.auth.onAuthStateChange((event, session) => {
      this.signedIn.set(Boolean(session));
      if (session) { void this.loadOrders(); void this.loadSpecial(); }
      if (event === 'PASSWORD_RECOVERY') this.recoveryMode.set(true);
    });
  }

  protected async signIn(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const { error } = await this.supabase.auth.signInWithPassword({ email: String(data.get('email')), password: String(data.get('password')) });
    this.message.set(error ? 'Sign-in failed. Check the email and password.' : 'Signed in securely.');
  }

  protected async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    this.message.set('You are signed out.');
  }

  protected async loadOrders(): Promise<void> {
    this.ordersLoading.set(true);
    const { data, error } = await this.supabase
      .from('orders')
      .select('id,customer_name,customer_email,customer_phone,requested_date,notes,subtotal_in_cents,payment_method,stripe_invoice_id,status,paid_at,pickup_time_confirmed,address_released_at,order_items(product_title,quantity,unit_price_in_cents)')
      .order('created_at', { ascending: false })
      .limit(100);
    this.ordersLoading.set(false);
    if (error) {
      this.message.set('Orders could not be loaded. Confirm the database migration and administrator access.');
      return;
    }
    this.orders.set((data ?? []) as AdminOrder[]);
  }

  protected async loadSpecial(): Promise<void> {
    const { data } = await this.supabase.from('specials').select('title,qualifying_quantity,qualifying_unit_price_in_cents,bundle_price_in_cents,is_active').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    this.special.set((data as Special | null) ?? null);
  }

  protected async saveSpecial(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const { data: sessionData } = await this.supabase.auth.getSession();
    if (!sessionData.session) { this.message.set('Sign in again before changing a special.'); return; }
    this.specialSaving.set(true);
    const response = await fetch('/api/manage-special', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
      body: JSON.stringify({ title: String(data.get('title')).trim(), quantity: Number(data.get('quantity')), unitPriceInCents: Math.round(Number(data.get('unitPrice')) * 100), bundlePriceInCents: Math.round(Number(data.get('bundlePrice')) * 100), isActive: data.get('isActive') === 'true' }),
    });
    const result = await response.json() as { error?: string };
    this.specialSaving.set(false);
    if (!response.ok) { this.message.set(result.error ?? 'The special could not be saved.'); return; }
    await this.loadSpecial();
    this.message.set(data.get('isActive') === 'true' ? 'The special is live on the website and its matching Stripe price was created.' : 'The special is off. Customers now pay the regular product prices.');
  }

  protected async markCashPaid(order: AdminOrder): Promise<void> {
    if (!confirm(`Confirm that $${(order.subtotal_in_cents / 100).toFixed(2)} cash was received from ${order.customer_name}?`)) return;
    const { data } = await this.supabase.auth.getSession();
    if (!data.session) { this.message.set('Sign in again before recording cash.'); return; }
    const response = await fetch('/api/mark-cash-paid', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ orderId: order.id }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) { this.message.set(result.error ?? 'The cash payment could not be recorded.'); return; }
    this.message.set('Cash received. The order is paid, Stripe recorded it as an out-of-band cash sale, and the pickup address was released.');
    await this.loadOrders();
  }

  protected async requestPasswordReset(form: HTMLFormElement): Promise<void> {
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    if (!email) {
      this.message.set('Enter your administrator email first.');
      return;
    }

    this.passwordResetStatus.set('sending');
    this.message.set(`Sending a secure password-reset email to ${email}…`);
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, { redirectTo: ADMIN_RECOVERY_URL });
    this.passwordResetStatus.set('idle');

    if (error) {
      const rateLimited = error.message.toLowerCase().includes('rate limit');
      this.message.set(rateLimited
        ? 'Too many reset emails were requested. Wait a few minutes, then try again.'
        : 'The reset email could not be sent. Please try again.');
      return;
    }

    this.message.set(`Password-reset email sent to ${email}. Check the inbox and spam folder, then use the secure link to choose a new password.`);
  }

  protected async updatePassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const password = String(data.get('newPassword'));
    const confirmation = String(data.get('confirmPassword'));
    if (password !== confirmation) {
      this.message.set('The passwords do not match. Enter the same password in both fields.');
      return;
    }
    const { error } = await this.supabase.auth.updateUser({ password });
    if (error) {
      this.message.set('The password could not be changed. Request a new reset link and try again.');
      return;
    }

    form.reset();
    await this.supabase.auth.signOut();
    this.document.location.assign('/admin?password=changed');
  }

  protected async cancelPasswordReset(): Promise<void> {
    await this.supabase.auth.signOut();
    this.document.location.assign('/admin');
  }

  protected editProduct(product: Product): void {
    this.editingId.set(product.id);
    this.imagePreview.set(product.imageUrl);
    this.message.set('');
    queueMicrotask(() => {
      const form = document.querySelector<HTMLFormElement>('#product-editor');
      if (!form) return;
      (form.elements.namedItem('title') as HTMLInputElement).value = product.title;
      (form.elements.namedItem('description') as HTMLTextAreaElement).value = product.description;
      (form.elements.namedItem('price') as HTMLInputElement).value = (product.priceInCents / 100).toFixed(2);
      (form.elements.namedItem('category') as HTMLInputElement).value = product.category;
      (form.elements.namedItem('imageAlt') as HTMLInputElement).value = product.imageAlt;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  protected async saveProduct(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const existing = this.products().find((product) => product.id === this.editingId());
    let imageUrl = existing?.imageUrl || '';

    if (this.selectedImage) {
      try { imageUrl = await this.productRepository.uploadImage(this.selectedImage); }
      catch { this.message.set('The picture could not be uploaded. Please try again.'); return; }
    }

    if (!imageUrl) {
      this.message.set('Upload a product picture before saving.');
      return;
    }

    const product: Product = {
      id: existing?.id ?? this.productRepository.nextProductId(),
      title: String(data.get('title')).trim(),
      description: String(data.get('description')).trim(),
      priceInCents: Math.round(Number(data.get('price')) * 100),
      category: String(data.get('category')).trim(),
      imageAlt: String(data.get('imageAlt')).trim(),
      imageUrl,
    };

    try { await this.productRepository.saveProduct(product); }
    catch { this.message.set('The product could not be saved. Confirm this account has administrator access.'); return; }
    form.reset();
    this.editingId.set(null);
    this.imagePreview.set('');
    this.selectedImage = null;
    this.message.set(`${product.title} was saved.`);
  }

  protected previewImage(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.message.set('Choose a valid image file.');
      return;
    }
    if (file.size > 1_500_000) {
      this.message.set('Choose an image smaller than 1.5 MB for this local preview.');
      return;
    }
    this.selectedImage = file;
    const reader = new FileReader();
    reader.onload = () => this.imagePreview.set(String(reader.result));
    reader.readAsDataURL(file);
  }

  protected async deleteProduct(product: Product): Promise<void> {
    if (!confirm(`Delete ${product.title}?`)) return;
    try { await this.productRepository.deleteProduct(product.id); }
    catch { this.message.set('The product could not be removed. Confirm this account has administrator access.'); return; }
    this.message.set(`${product.title} was deleted.`);
    if (this.editingId() === product.id) this.cancelEdit();
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.imagePreview.set('');
    this.selectedImage = null;
    document.querySelector<HTMLFormElement>('#product-editor')?.reset();
  }
}
