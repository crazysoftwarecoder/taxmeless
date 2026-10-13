/** Writes dist/sitemap.xml and dist/robots.txt after `vite build`. lastmod = newest data verification date. */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://crazysoftwarecoder.github.io/where-it-grows/';
const root = join(import.meta.dirname, '..');

function newestVerified(dir: string): string {
  let best = '';
  const walk = (p: string) => {
    for (const f of readdirSync(p)) {
      const full = join(p, f);
      if (statSync(full).isDirectory()) walk(full);
      else if (f.endsWith('.json')) for (const m of readFileSync(full, 'utf8').matchAll(/"last_verified":\s*"(\d{4}-\d{2}-\d{2})"/g)) if (m[1]! > best) best = m[1]!;
    }
  };
  walk(dir);
  return best || new Date().toISOString().slice(0, 10);
}

const lastmod = newestVerified(join(root, 'data'));
writeFileSync(join(root, 'dist/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`);
writeFileSync(join(root, 'dist/robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
console.log(`sitemap.xml written (lastmod ${lastmod})`);
