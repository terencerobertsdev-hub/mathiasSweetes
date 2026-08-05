import { ChangeDetectionStrategy, Component } from '@angular/core';
import { GALLERY_ITEMS, INSTAGRAM_URL, WHATSAPP_URL } from './site-content';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly galleryItems = GALLERY_ITEMS;
  protected readonly whatsappUrl = WHATSAPP_URL;
  protected readonly instagramUrl = INSTAGRAM_URL;
  protected readonly currentYear = new Date().getFullYear();
}
