import Image from 'next/image'

// The logo is one picture; three clipped copies (mark, divider line, wordmark)
// let each part arrive on its own beat while the ring draws around the mark.
const PARTS = ['rp-logo-mark', 'rp-logo-line', 'rp-logo-text']

export function LoginLogo() {
  return (
    <div className="text-center mb-8">
      <div className="rp-logo mx-auto w-[27rem] max-w-full" role="img" aria-label="RP Intelligence">
        {PARTS.map((part) => (
          <Image key={part} src="/logo-full-v4.png" alt="" width={1498} height={890} sizes="27rem" priority className={part} />
        ))}
        <svg viewBox="0 0 1498 890" fill="none" aria-hidden className="rp-logo-ring">
          <circle cx="415" cy="445" r="306" stroke="#16243d" strokeWidth="9" pathLength={100} />
        </svg>
      </div>
      <p className="rp-logo-tag mt-3 text-sm text-gray-500">Rappahannock Petroleum Operations Platform</p>
    </div>
  )
}
