// Starts the SSR server of each build and resolves once all of them answer.
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function startServers(names, firstPort, env = {}) {
  const variants = names.map((name, i) => ({name, port: firstPort + i}));
  const servers = variants.map(({name, port}) =>
    spawn(process.execPath, [join(root, 'dist', name, 'server', 'server.mjs')], {
      env: {...process.env, ...env, PORT: String(port)},
      stdio: 'ignore',
    }));
  const stop = () => servers.forEach((server) => server.kill());
  process.on('exit', stop);
  for (const {name, port} of variants) {
    for (let attempt = 0; ; attempt++) {
      try {
        if ((await fetch(`http://localhost:${port}/img/ping`)).ok) break;
      } catch {}
      if (attempt > 100) throw new Error(`dist/${name} did not start. Run npm run build:variants.`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return {variants, stop};
}
