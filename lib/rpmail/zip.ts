// A small zip writer for "Download all" in the message reader. It runs in the browser on files the person has
// already been allowed to open, so nothing new passes through the server. Files are stored as they are (no
// compression): PDFs and pictures are already compressed, and it keeps this to a page of code with no library.

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Names safe for any computer, and never two the same (the second "plan.pdf" becomes "plan (2).pdf"). */
export function zipNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map(raw => {
    const clean = (raw || 'attachment').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim().slice(0, 150) || 'attachment'
    const key = clean.toLowerCase()
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n === 1) return clean
    const dot = clean.lastIndexOf('.')
    return dot > 0 ? `${clean.slice(0, dot)} (${n})${clean.slice(dot)}` : `${clean} (${n})`
  })
}

export function makeZip(files: { name: string; data: Uint8Array }[], at = new Date()): Uint8Array {
  const enc = new TextEncoder()
  const names = zipNames(files.map(f => f.name)).map(n => enc.encode(n))
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1)
  const date = ((Math.max(1980, at.getFullYear()) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()
  const total = files.reduce((n, f, i) => n + 30 + names[i].length + f.data.length + 46 + names[i].length, 22)
  const out = new Uint8Array(total), v = new DataView(out.buffer)
  const where: number[] = [], sums: number[] = []
  let o = 0
  files.forEach((f, i) => {
    where.push(o); sums.push(crc32(f.data))
    v.setUint32(o, 0x04034b50, true); v.setUint16(o + 4, 20, true); v.setUint16(o + 6, 0x0800, true)   // names are UTF-8
    v.setUint16(o + 8, 0, true); v.setUint16(o + 10, time, true); v.setUint16(o + 12, date, true)
    v.setUint32(o + 14, sums[i], true); v.setUint32(o + 18, f.data.length, true); v.setUint32(o + 22, f.data.length, true)
    v.setUint16(o + 26, names[i].length, true); v.setUint16(o + 28, 0, true)
    out.set(names[i], o + 30); out.set(f.data, o + 30 + names[i].length)
    o += 30 + names[i].length + f.data.length
  })
  const dirStart = o
  files.forEach((f, i) => {
    v.setUint32(o, 0x02014b50, true); v.setUint16(o + 4, 20, true); v.setUint16(o + 6, 20, true); v.setUint16(o + 8, 0x0800, true)
    v.setUint16(o + 10, 0, true); v.setUint16(o + 12, time, true); v.setUint16(o + 14, date, true)
    v.setUint32(o + 16, sums[i], true); v.setUint32(o + 20, f.data.length, true); v.setUint32(o + 24, f.data.length, true)
    v.setUint16(o + 28, names[i].length, true)   // no extra field, no comment, disk 0, no attributes
    v.setUint32(o + 42, where[i], true)
    out.set(names[i], o + 46)
    o += 46 + names[i].length
  })
  v.setUint32(o, 0x06054b50, true); v.setUint16(o + 8, files.length, true); v.setUint16(o + 10, files.length, true)
  v.setUint32(o + 12, o - dirStart, true); v.setUint32(o + 16, dirStart, true)
  return out
}
