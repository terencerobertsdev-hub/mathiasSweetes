import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Product } from '../pos/product.model';
import { ProductRepository } from '../pos/product-repository.service';
import { SupabaseService } from '../supabase.service';

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

  protected readonly products = this.productRepository.getProducts();
  protected readonly editingId = signal<number | null>(null);
  protected readonly imagePreview = signal('');
  protected readonly message = signal('');
  protected readonly signedIn = signal(false);
  protected readonly recoveryMode = signal(false);
  private selectedImage: File | null = null;

  constructor() {
    void this.supabase.auth.getSession().then(({ data }) => this.signedIn.set(Boolean(data.session)));
    this.supabase.auth.onAuthStateChange((event, session) => {
      this.signedIn.set(Boolean(session));
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

  protected async requestPasswordReset(form: HTMLFormElement): Promise<void> {
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    if (!email) {
      this.message.set('Enter your administrator email first.');
      return;
    }
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin` });
    this.message.set(error ? 'The reset email could not be sent. Please try again.' : 'Check your email for a secure password-reset link.');
  }

  protected async updatePassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const password = String(new FormData(form).get('newPassword'));
    const { error } = await this.supabase.auth.updateUser({ password });
    this.message.set(error ? 'The password could not be changed. Try the reset link again.' : 'Your password has been changed.');
    if (!error) this.recoveryMode.set(false);
    form.reset();
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
