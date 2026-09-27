import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Build hash over everything that affects the simulation (plan §11 "データの版管理").
// It is embedded in the connection QR; peers with different hashes can't play together.
function simHash(): string {
  const h = createHash('sha256');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) h.update(relative(import.meta.dirname, p)).update(readFileSync(p));
    }
  };
  walk(join(import.meta.dirname, 'src/core'));
  walk(join(import.meta.dirname, 'src/data'));
  h.update(readFileSync(join(import.meta.dirname, 'src/net/rollback.ts')));
  return h.digest('hex').slice(0, 8);
}

const BUILD_HASH = simHash();

/** Emits sw.js with a precache list of the built assets (offline play after first load). */
function serviceWorker(): Plugin {
  return {
    name: 'polygon-duel-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const src = readFileSync(join(import.meta.dirname, 'src/sw-template.js'), 'utf8')
        .replace('__CACHE__', `polygon-duel-${BUILD_HASH}-${Date.now().toString(36)}`)
        .replace('__FILES__', JSON.stringify(['./', ...files, 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __BUILD_HASH__: JSON.stringify(BUILD_HASH),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: { host: true },
  // HTTPS=1 npm run dev → self-signed HTTPS so phones on the LAN may use the camera
  plugins: [serviceWorker(), ...(process.env.HTTPS ? [basicSsl()] : [])],
});
