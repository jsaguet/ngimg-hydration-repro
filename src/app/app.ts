import {afterEveryRender, Component} from '@angular/core';
import {RouterOutlet} from '@angular/router';
import {benchHooks} from '../bench-hooks';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  constructor() {
    afterEveryRender(() => benchHooks()?.onRender());
  }
}
