// Serves the benchmark page and answers every /img/* request with a cacheable 400x600 PNG,
// so the "server-rendered" images actually load (like a real CDN) before hydration is replayed.
// Usage: node dom-benchmark/serve.mjs [port]   then open http://localhost:<port>/
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function png(w, h) {
  const crcTable = Array.from({length: 256}, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x9c)]);
  const raw = Buffer.concat(Array.from({length: h}, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const image = png(400, 600);
const page = () => readFileSync(join(here, 'index.html'));

// Number of image requests that reached the server, per path prefix (e.g. '/img/slow/<nonce>/').
export const imageHits = [];

export function serve(port = 0) {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/img/')) {
      imageHits.push(req.url);
      const send = () => {
        res.writeHead(200, {'content-type': 'image/png', 'cache-control': 'public, max-age=31536000'});
        res.end(image);
      };
      // '/img/slow/...' simulates images still downloading when hydration runs.
      if (req.url.startsWith('/img/slow/')) setTimeout(send, 2000);
      else send();
    } else if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      res.end(page());
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await serve(Number(process.argv[2] ?? 8080));
  console.log(`http://localhost:${server.address().port}/`);
}
