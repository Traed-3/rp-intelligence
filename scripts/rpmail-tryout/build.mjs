// A stand-alone copy of the RPMail page that runs on made-up mail: no sign-in, no server, no Gmail, nothing leaves the page.
// For looking at the screens in a browser when no real mailbox is connected (the automated tests cover the server side only).
//
//   node scripts/rpmail-tryout/build.mjs [output folder]      (default: .next/rpmail-tryout)
//   then serve that folder with any static file server and open it, e.g.  python3 -m http.server 8732 --directory .next/rpmail-tryout
//   Add #window to the address for the mail window (folders in the navy menu), #settings or #help for those pages.
//
// The page is the real components/rpmail code and the real styling; only the server answers are made up (entry.tsx).
// esbuild and postcss come in with the project's other tools (vitest, Tailwind); this script is never part of the site build.
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'
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
  alias: { '@/lib/supabase/client': resolve(here, 'supabase-shim.ts'), 'next/link': resolve(here, 'link-shim.tsx'), 'next/image': resolve(here, 'image-shim.tsx'), '@': root },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY': '""', 'process.env.NEXT_PUBLIC_SUPABASE_URL': '""', 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '""' },
})

// A picture placed in the text is shown from /api/rpmail/attach_view. With no server here, one sample picture
// (a plain blue-grey rectangle, made on the spot) stands in for every picture.
const W = 320, H = 180, row = Buffer.concat([Buffer.from([0]), Buffer.alloc(W * 3, Buffer.from([0x8f, 0xa3, 0xc2]))])
const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc32(body) >>> 0); return Buffer.concat([len, body, sum]) }
const head = Buffer.alloc(13); head.writeUInt32BE(W, 0); head.writeUInt32BE(H, 4); head.set([8, 2, 0, 0, 0], 8)
mkdirSync(resolve(out, 'api/rpmail'), { recursive: true })
writeFileSync(resolve(out, 'api/rpmail/attach_view'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(Array(H).fill(row)))), chunk('IEND', Buffer.alloc(0))]))

copyFileSync(resolve(root, 'public/logo-full-v4.png'), resolve(out, 'logo-full-v4.png'))   // the logo in the mail window's menu
writeFileSync(resolve(out, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RPMail try-out</title><link rel="stylesheet" href="app.css"></head><body class="bg-background text-foreground"><div id="root"></div><script src="out.js"></script></body></html>\n')
console.log('RPMail try-out built in ' + out)
