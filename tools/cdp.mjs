// Minimal Chrome DevTools Protocol client: launches headless Chrome and opens one page.
// No npm deps (uses Node's built-in WebSocket/fetch, Node >= 22).
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const defaultChromePath =
  process.env.CHROME_PATH ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : 'google-chrome');

export async function openPage(url, chromePath = defaultChromePath) {
  const profile = mkdtempSync(join(tmpdir(), 'ngimg-bench-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--window-size=1280,900', 'about:blank',
  ], {stdio: ['ignore', 'ignore', 'pipe']});

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    chrome.on('exit', (c) => reject(new Error(`chrome exited (${c})`)));
  });

  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, {once: true}));

  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else for (const l of listeners) l(msg);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({id: n, method, params}));
  });
  const on = (method, cb) => {
    const l = (m) => m.method === method && cb(m.params);
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const evaluate = async (expression) => {
    const {result, exceptionDetails} = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };

  await send('Page.enable');
  const loaded = new Promise((r) => { const off = on('Page.loadEventFired', () => { off(); r(); }); });
  await send('Page.navigate', {url});
  await loaded;
  const {product} = await send('Browser.getVersion');

  const close = () => {
    ws.close();
    chrome.kill();
    setTimeout(() => { try { rmSync(profile, {recursive: true, force: true}); } catch {} }, 500);
  };
  return {send, on, evaluate, close, product};
}
