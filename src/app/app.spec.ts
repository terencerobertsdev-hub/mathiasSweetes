import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { Admin } from './admin/admin';
import { PointOfSale } from './pos/point-of-sale';
import { SupabaseService } from './supabase.service';

describe('Mathias Treats site', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Admin, App, PointOfSale] }).compileComponents();
  });

  it('routes WhatsApp ordering to the parent-managed Fawaii number', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Sweet treats');
    expect(element.querySelectorAll('a[href^="https://wa.me/16783573948"]').length).toBeGreaterThan(0);
    expect(element.querySelectorAll('a').length).toBeGreaterThan(0);
    expect(element.textContent).toContain('WhatsApp');
    expect(element.querySelector('form#order-form')).toBeNull();
    expect(element.querySelector('section#order-form form')).not.toBeNull();
    expect(element.textContent).toContain('parent or guardian');
    expect(element.textContent).toContain('Place a custom order');
    expect(element.textContent).toContain('standard treats and common flavors');
    expect(element.querySelector('#order-form a[href="/shop"]')).not.toBeNull();
    expect(element.querySelector('a[href="https://fawaii-custom-cookies.com/"]')).not.toBeNull();
    expect(element.querySelector('.fawaii-support img')?.getAttribute('alt')).toBe('Fawaii logo');
    expect(element.textContent).toContain('Website crafted by');
    expect(element.querySelector('footer a[href="https://canton-digital-works.com/"]')).not.toBeNull();
  });

  it('provides useful alternative text for displayed content images', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const contentImages = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('main img'));

    expect(contentImages.length).toBeGreaterThan(0);
    expect(contentImages.every((image) => image.getAttribute('alt')?.trim())).toBe(true);
  });

  it('keeps the point of sale on the dedicated Shop destination', () => {
    const appFixture = TestBed.createComponent(App);
    appFixture.detectChanges();
    const appElement = appFixture.nativeElement as HTMLElement;

    expect(appElement.querySelector('a[href="/shop"]')).not.toBeNull();
    expect(appElement.querySelector('section#shop')).toBeNull();

    const fixture = TestBed.createComponent(PointOfSale);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('section#shop')).not.toBeNull();
    expect(element.querySelectorAll('.product-card').length).toBe(4);
    expect(element.querySelectorAll('input[type="number"]').length).toBe(4);
    expect(element.textContent).toContain('Classic Vanilla Cakesicle');
    expect(element.textContent).toContain('$3.00');
    expect(element.textContent).toContain('Your cart is waiting');
  });

  it('applies the four-for-ten-dollar offer', () => {
    const fixture = TestBed.createComponent(PointOfSale);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const addButton = element.querySelector('.quantity-control button:last-child') as HTMLButtonElement;

    addButton.click();
    addButton.click();
    addButton.click();
    addButton.click();
    fixture.detectChanges();

    expect(element.querySelector('.cart-lines')).not.toBeNull();
    expect(element.querySelector('.cart-total')?.textContent).toContain('$10.00');
    expect(element.textContent).toContain('You saved $2.00');
    expect(element.querySelector('.checkout-button')?.hasAttribute('disabled')).toBe(false);
  });

  it('protects the product editor behind administrator sign-in', () => {
    const fixture = TestBed.createComponent(Admin);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('input[type="email"][autocomplete="username"]')).not.toBeNull();
    expect(element.querySelector('input[type="password"][autocomplete="current-password"]')).not.toBeNull();
    expect(element.querySelector('form#product-editor')).toBeNull();
    expect(element.textContent).toContain('Authorized staff only');
  });

  it('keeps Admin as the final main-navigation item', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('nav a'));

    expect(links.at(-1)?.textContent?.trim()).toBe('Admin');
    expect(links.at(-1)?.getAttribute('href')).toBe('/admin');
  });

  it('confirms when an administrator password-reset email is accepted', async () => {
    const supabase = TestBed.inject(SupabaseService).client;
    const reset = vi.spyOn(supabase.auth, 'resetPasswordForEmail').mockResolvedValue({ data: {}, error: null });
    const fixture = TestBed.createComponent(Admin);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const email = element.querySelector('#admin-email') as HTMLInputElement;
    const resetButton = Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.includes('Forgot')) as HTMLButtonElement;

    email.value = 'admin@example.com';
    resetButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(reset).toHaveBeenCalledWith('admin@example.com', { redirectTo: 'https://mathiastreats.com/admin/reset-password' });
    expect(element.textContent).toContain('Password-reset email sent to admin@example.com');
  });
});
