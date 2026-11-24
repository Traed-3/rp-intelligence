// Re-mounts when you move between sections, so each page fades in with a slight rise.
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="rp-page-in">{children}</div>
}
