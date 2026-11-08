import {Routes} from '@angular/router';
import {DataTable} from './data-table';
import {MediaPage} from './media-page';
import {ProductGrid} from './product-grid';

export const routes: Routes = [
  {path: '', component: ProductGrid},
  {path: 'table', component: DataTable},
  {path: 'media', component: MediaPage},
];
