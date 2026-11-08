// Records public/clip.webm: a 12-second video that shows the elapsed seconds, so a restart is visible.
// Usage: node tools/make-clip.mjs [path-to-chrome]
import {writeFileSync} from 'node:fs';
import {openPage} from './cdp.mjs';

const page = await openPage('about:blank', process.argv[2]);
const base64 = await page.evaluate(`new Promise((resolve) => {
  const canvas = Object.assign(document.createElement('canvas'), {width: 480, height: 270});
  const ctx = canvas.getContext('2d');
  const started = performance.now();
  const draw = () => {
    const elapsed = (performance.now() - started) / 1000;
    ctx.fillStyle = '#1b3a6b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 120px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(elapsed.toFixed(1) + ' s', canvas.width / 2, canvas.height / 2);
  };
  const timer = setInterval(draw, 33);
  draw();
  const recorder = new MediaRecorder(canvas.captureStream(30), {mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 300000});
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = async () => {
    clearInterval(timer);
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    resolve(btoa(binary));
  };
  recorder.start();
  setTimeout(() => recorder.stop(), 12000);
})`);
writeFileSync(new URL('../public/clip.webm', import.meta.url), Buffer.from(base64, 'base64'));
console.log('public/clip.webm:', Buffer.from(base64, 'base64').length, 'bytes');
page.close();
setTimeout(() => process.exit(0), 300);
