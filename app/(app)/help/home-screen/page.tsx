import Link from 'next/link'
import { InstallApp } from '@/components/help/install-app'
import { HOME_SCREEN_GUIDE } from '@/lib/help'

// Technical Help > Add to your Home Screen. Open to everyone who signs in, like the rest of /help.
export default function HomeScreenHelpPage() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title">{HOME_SCREEN_GUIDE.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{HOME_SCREEN_GUIDE.summary}</p>
        </div>
        <Link href="/help" className="text-sm text-gray-500 hover:text-gray-700">← Technical Help</Link>
      </div>
      <InstallApp />
    </div>
  )
}
