import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { Product } from './product.model';
import { SupabaseService } from '../supabase.service';

const LOCAL_PRODUCTS: Product[] = [
  {
    id: 1,
    title: 'Classic Vanilla Cakesicle',
    description: 'Vanilla cake wrapped in a smooth white chocolate shell and finished with a cheerful sprinkle mix.',
    priceInCents: 300,
    imageUrl: 'assets/treats/vanilla-cakesicles.jpg',
    imageAlt: 'Individually wrapped vanilla cakesicles with white chocolate coating',
    category: 'Cakesicles',
  },
  {
    id: 2,
    title: 'Celebration Sprinkle Cakesicle',
    description: 'A party-ready cakesicle covered in colorful sprinkles. Perfect for birthdays and happy moments.',
    priceInCents: 300,
    imageUrl: 'assets/treats/sprinkle-cakesicles.jpg',
    imageAlt: 'White cakesicles decorated with colorful sprinkles',
    category: 'Cakesicles',
  },
  {
    id: 3,
    title: 'Custom Color Cakesicle',
    description: 'Choose a color direction for a hand-decorated cakesicle made to match your celebration.',
    priceInCents: 300,
    imageUrl: 'assets/treats/yellow-cakesicle.jpg',
    imageAlt: 'Bright yellow cakesicle with aqua decoration',
    category: 'Custom',
  },
  {
    id: 4,
    title: 'Stars & Stripes Cakesicle',
    description: 'A festive red, white, and blue cakesicle with playful patriotic details.',
    priceInCents: 300,
    imageUrl: 'assets/treats/usa-cakesicle.jpg',
    imageAlt: 'Red, white, and blue USA cakesicle',
    category: 'Seasonal',
  },
];

@Injectable({ providedIn: 'root' })
export class ProductRepository {
  private readonly storageKey = 'mathias-treats-products';
  private readonly platformId = inject(PLATFORM_ID);
  private readonly supabase = inject(SupabaseService).client;
  private readonly productsState = signal<readonly Product[]>(this.loadProducts());

  constructor() {
    if (isPlatformBrowser(this.platformId)) void this.refreshProducts();
  }

  // This local catalog is the development fallback. A future SQL-backed API
  // can replace this method without changing the product cards or cart.
  getProducts() {
    return this.productsState.asReadonly();
  }

  async refreshProducts(): Promise<void> {
    const { data, error } = await this.supabase.from('products').select('id,title,description,price_in_cents,image_url,image_alt,category').order('id');
    if (error) return;
    this.productsState.set(data.map((row) => ({ id: row.id, title: row.title, description: row.description, priceInCents: row.price_in_cents, imageUrl: row.image_url, imageAlt: row.image_alt, category: row.category })));
  }

  async saveProduct(product: Product): Promise<void> {
    const { error } = await this.supabase.from('products').upsert({ id: product.id, title: product.title, description: product.description, price_in_cents: product.priceInCents, image_url: product.imageUrl, image_alt: product.imageAlt, category: product.category, is_active: true });
    if (error) throw error;
    const products = [...this.productsState()];
    const existingIndex = products.findIndex((item) => item.id === product.id);
    existingIndex >= 0 ? products.splice(existingIndex, 1, product) : products.push(product);
    this.persist(products);
  }

  async deleteProduct(productId: number): Promise<void> {
    const { error } = await this.supabase.from('products').update({ is_active: false }).eq('id', productId);
    if (error) throw error;
    this.persist(this.productsState().filter((product) => product.id !== productId));
  }

  nextProductId(): number {
    return Math.max(0, ...this.productsState().map((product) => product.id)) + 1;
  }

  async uploadImage(file: File): Promise<string> {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${crypto.randomUUID()}.${extension}`;
    const { error } = await this.supabase.storage.from('product-images').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return this.supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
  }

  resetProducts(): void {
    this.persist(LOCAL_PRODUCTS);
  }

  private loadProducts(): readonly Product[] {
    if (!isPlatformBrowser(this.platformId)) return LOCAL_PRODUCTS;
    const storedProducts = localStorage.getItem(this.storageKey);
    if (!storedProducts) return LOCAL_PRODUCTS;

    try {
      return JSON.parse(storedProducts) as Product[];
    } catch {
      return LOCAL_PRODUCTS;
    }
  }

  private persist(products: readonly Product[]): void {
    this.productsState.set(products);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(this.storageKey, JSON.stringify(products));
    }
  }
}
