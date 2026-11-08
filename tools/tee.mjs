// Copies everything printed with console.log and console.table to a file.
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

export function teeConsole(path) {
  mkdirSync(dirname(path), {recursive: true});
  const lines = [];
  const log = console.log;
  console.log = (...args) => {
    log(...args);
    lines.push(args.join(' '));
    writeFileSync(path, lines.join('\n') + '\n');
  };
}
