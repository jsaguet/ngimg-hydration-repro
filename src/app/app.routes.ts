import {Routes} from '@angular/router';
import {DataTable} from './data-table';
import {MediaPage} from './media-page';
import {ProductGrid, ProductGridBound} from './product-grid';

export const routes: Routes = [
  {path: '', component: ProductGrid},
  {path: 'bound', component: ProductGridBound},
  {path: 'table', component: DataTable},
  {path: 'media', component: MediaPage},
];
