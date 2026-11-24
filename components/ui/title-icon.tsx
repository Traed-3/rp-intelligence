import type { LucideIcon } from 'lucide-react'
import type { Tone } from './status-pill'

/** The colored icon chip in front of a page title. Pick the tone by meaning (see Tone). */
export function TitleIcon({ icon: Icon, tone = 'info' }: { icon: LucideIcon; tone?: Tone }) {
  return <span className="rp-title-chip" data-tone={tone} aria-hidden><Icon /></span>
}
