import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('Mathias Treats site', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('routes WhatsApp ordering to the parent-managed Fawaii number', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Sweet treats');
    expect(element.querySelectorAll('a[href^="https://wa.me/16783573948"]').length).toBeGreaterThan(0);
    expect(element.querySelectorAll('a').length).toBeGreaterThan(0);
    expect(element.textContent).toContain('Make a Request');
    expect(element.querySelector('form#order-form')).toBeNull();
    expect(element.querySelector('section#order-form form')).not.toBeNull();
    expect(element.textContent).toContain('parent or guardian');
    expect(element.querySelector('a[href="https://fawaii-custom-cookies.com/"]')).not.toBeNull();
    expect(element.querySelector('.fawaii-support img')?.getAttribute('alt')).toBe('Fawaii logo');
  });

  it('provides useful alternative text for displayed content images', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const contentImages = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('main img'));

    expect(contentImages.length).toBeGreaterThan(0);
    expect(contentImages.every((image) => image.getAttribute('alt')?.trim())).toBe(true);
  });
});
