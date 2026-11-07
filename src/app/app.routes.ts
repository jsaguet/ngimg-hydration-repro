import {Routes} from '@angular/router';
import {DataTable} from './data-table';
import {ProductGrid} from './product-grid';

export const routes: Routes = [
  {path: '', component: ProductGrid},
  {path: 'table', component: DataTable},
];
