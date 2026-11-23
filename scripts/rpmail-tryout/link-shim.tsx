import type { ReactNode } from 'react'
export default function Link({ href, children, ...p }: { href: string; children?: ReactNode; [k: string]: unknown }) { return <a href={href} {...(p as object)}>{children}</a> }
