// A stand-alone copy of the RPMail page that runs on made-up mail: no sign-in, no server, no Gmail, nothing leaves the page.
// For looking at the screens in a browser when no real mailbox is connected (the automated tests cover the server side only).
//
//   node scripts/rpmail-tryout/build.mjs [output folder]      (default: .next/rpmail-tryout)
//   then serve that folder with any static file server and open it, e.g.  python3 -m http.server 8732 --directory .next/rpmail-tryout
//
// The page is the real components/rpmail code and the real styling; only the server answers are made up (entry.tsx).
// esbuild and postcss come in with the project's other tools (vitest, Tailwind); this script is never part of the site build.
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..')
const out = resolve(process.argv[2] ?? resolve(root, '.next/rpmail-tryout'))
process.chdir(root)
mkdirSync(out, { recursive: true })

const css = await postcss([tailwind()]).process(readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css', to: resolve(out, 'app.css') })
writeFileSync(resolve(out, 'app.css'), css.css)

await build({
  entryPoints: [resolve(here, 'entry.tsx')], bundle: true, outfile: resolve(out, 'out.js'), jsx: 'automatic', logLevel: 'error',
  alias: { '@/lib/supabase/client': resolve(here, 'supabase-shim.ts'), 'next/link': resolve(here, 'link-shim.tsx'), '@': root },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY': '""', 'process.env.NEXT_PUBLIC_SUPABASE_URL': '""', 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '""' },
})

writeFileSync(resolve(out, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RPMail try-out</title><link rel="stylesheet" href="app.css"></head><body class="bg-background text-foreground"><div id="root"></div><script src="out.js"></script></body></html>\n')
console.log('RPMail try-out built in ' + out)
