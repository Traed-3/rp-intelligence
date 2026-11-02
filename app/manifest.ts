import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RP Intelligence',
    short_name: 'RP Intel',
    description: 'RP Intelligence — Rappahannock Petroleum operations platform',
    start_url: '/mobile',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#16243d',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192-v2.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512-v2.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: 'Field Surveys',
        short_name: 'Surveys',
        url: '/construction/surveys',
        description: 'Start or continue an ICON field survey',
      },
      {
        name: 'Clock In / Out',
        short_name: 'Clock',
        url: '/shop/clock',
        description: 'Clock in or out of your shift',
      },
      {
        name: 'My Tasks',
        short_name: 'Tasks',
        url: '/shop/my-tasks',
        description: 'View your assigned repair tickets',
      },
    ],
  }
}
