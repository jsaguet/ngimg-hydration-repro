import {NgOptimizedImage} from '@angular/common';
import {Component, signal} from '@angular/core';
import {benchHooks} from '../bench-hooks';

export const PRODUCT_COUNT = 200;
/** The first row is above the fold: hero-like images marked `priority`. */
export const PRIORITY_COUNT = 4;

interface Product {
  id: number;
  name: string;
  image: string;
  /** How many times the template's `(load)` handler ran for this image. */
  loadCalls: ReturnType<typeof signal<number>>;
}

/** Image-heavy page: 200 NgOptimizedImage cards with a responsive srcset and a `(load)` handler. */
@Component({
  selector: 'app-product-grid',
  imports: [NgOptimizedImage],
  templateUrl: './product-grid.html',
  styleUrl: './product-grid.css',
})
export class ProductGrid {
  protected readonly priorityCount = PRIORITY_COUNT;
  protected readonly products: Product[] = Array.from({length: PRODUCT_COUNT}, (_, i) => ({
    id: i,
    name: `Linen midi dress #${i + 1}`,
    image: `catalog/2024/summer/womens/dresses/linen-midi-dress-sage-green-front-view-${i}.jpg`,
    loadCalls: signal(0),
  }));

  /** A typical `(load)` handler, e.g. to fade an image in or hide a skeleton once it's loaded. */
  protected onImageLoad(product: Product) {
    product.loadCalls.update((n) => n + 1);
    benchHooks()?.onLoadHandler(product.id);
  }
}
