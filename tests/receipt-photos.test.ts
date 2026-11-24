import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { sniffImage } from '@/lib/billing-inbox-sync'

// The receipt reader was refusing photos labelled with the wrong type (a JPEG screenshot saved as .png) and phone photos
// over 10 MB once encoded (11/24/26). Photos are now re-saved as JPEG; when that fails the real type comes from the bytes.
describe('receipt photo type', () => {
  it('reads the real type from the bytes, not the file name', async () => {
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer()
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).webp().toBuffer()
    expect(sniffImage(jpeg, 'image/png')).toBe('image/jpeg')
    expect(sniffImage(png, 'image/jpeg')).toBe('image/png')
    expect(sniffImage(webp, 'image/png')).toBe('image/webp')
    expect(sniffImage(Buffer.from('GIF89a'), 'image/png')).toBe('image/gif')
  })

  it('keeps the label it was given when the bytes say nothing', () => {
    expect(sniffImage(Buffer.from('hello'), 'image/png')).toBe('image/png')
  })
})
