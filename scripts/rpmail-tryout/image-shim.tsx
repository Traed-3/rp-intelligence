// next/image for the try-out page: a plain picture tag (there is no Next.js server here to resize images).
export default function Image({ src, alt, width, height, className }: { src: string; alt: string; width?: number; height?: number; className?: string; priority?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element -- the try-out page has no Next.js server to hand pictures to
  return <img src={src.replace(/^\//, '')} alt={alt} width={width} height={height} className={className} />
}
