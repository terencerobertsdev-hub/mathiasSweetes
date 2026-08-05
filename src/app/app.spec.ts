import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('Mathias Treats site', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('renders the main heading and ordering links', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Sweet treats');
    expect(element.querySelectorAll('a[href^="https://wa.me/14707212700"]').length).toBeGreaterThan(0);
  });

  it('provides useful alternative text for displayed content images', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const contentImages = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('main img'));

    expect(contentImages.length).toBeGreaterThan(0);
    expect(contentImages.every((image) => image.getAttribute('alt')?.trim())).toBe(true);
  });
});
