import { RingLoader } from '@/components/ui/ring-loader'

// Shown while a page's data loads: grey placeholder blocks in the page's shape.
export default function AppLoading() {
  const block = 'rounded-2xl bg-gray-200/70 animate-pulse'
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto" aria-busy="true">
      <div className="flex items-center gap-3 mb-6 text-blue-700">
        <RingLoader className="w-6 h-6" />
        <div className={`${block} h-7 w-48 rounded-lg`} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-24`} />)}
      </div>
      <div className={`${block} h-10 mb-3 rounded-xl`} />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`${block} h-12 rounded-xl`} />)}
      </div>
    </div>
  )
}
