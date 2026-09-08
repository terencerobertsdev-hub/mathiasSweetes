import { ChangeDetectionStrategy, Component } from '@angular/core';

// The root application owns the shared header, footer, and page selection.
// This route marker lets Angular serve direct /shop requests without rendering
// a second copy of the page inside the root component.
@Component({
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoutePlaceholder {}
