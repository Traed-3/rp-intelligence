import { IS_DEMO } from '@/lib/demo'

/** Thin strip across the top of every page in the public demo. */
export function DemoBanner() {
  if (!IS_DEMO) return null
  return (
    <div className="sticky top-0 z-[60] w-full bg-amber-400 text-amber-950 text-center text-xs sm:text-sm font-semibold px-3 py-1.5 print:hidden">
      Demo — sample data. Everything here is fictional and resets every night.{' '}
      <a href="https://prestigesitestudio.com" className="underline underline-offset-2 font-bold">Built by PrestigeSite Studio</a>
    </div>
  )
}
