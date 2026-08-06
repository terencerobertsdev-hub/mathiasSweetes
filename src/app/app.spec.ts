import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('Mathias Treats site', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('renders the main heading with WhatsApp ordering visibly paused', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Sweet treats');
    expect(element.querySelectorAll('a[href*="wa.me"]').length).toBe(0);
    expect(element.querySelectorAll('button[disabled]').length).toBeGreaterThan(0);
    expect(element.textContent).toContain('WhatsApp is temporarily unavailable');
    expect(element.querySelector('form#order-form')).toBeNull();
    expect(element.querySelector('section#order-form form')).not.toBeNull();
    expect(element.textContent).toContain('parent or guardian');
  });

  it('provides useful alternative text for displayed content images', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const contentImages = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('main img'));

    expect(contentImages.length).toBeGreaterThan(0);
    expect(contentImages.every((image) => image.getAttribute('alt')?.trim())).toBe(true);
  });
});
