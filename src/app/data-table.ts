import {NgOptimizedImage} from '@angular/common';
import {Component} from '@angular/core';

export const ROW_COUNT = 300;

interface Row {
  id: number;
  name: string;
  status: string;
  warn: boolean;
  amount: string;
}

/**
 * Few images, lots of static markup: a 300-row table where every element carries static classes,
 * ARIA attributes, inline styles or SVG attributes, plus one class binding next to static classes.
 */
@Component({
  selector: 'app-data-table',
  imports: [NgOptimizedImage],
  templateUrl: './data-table.html',
  styleUrl: './data-table.css',
})
export class DataTable {
  protected readonly rows: Row[] = Array.from({length: ROW_COUNT}, (_, i) => ({
    id: 1000 + i,
    name: `Invoice INV-${String(1000 + i).padStart(6, '0')}`,
    status: i % 7 === 0 ? 'Overdue' : 'Paid',
    warn: i % 7 === 0,
    amount: `€${((i * 137) % 9000) + 100}.00`,
  }));
}
