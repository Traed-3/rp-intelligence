// Stands in for the browser's storage client: an "uploaded" file is only remembered on the page (see entry.tsx).
export const uploads = new Map<string, File>()
export const createClient = () => ({ storage: { from: () => ({ uploadToSignedUrl: async (path: string, _token: string, file: File) => { uploads.set(path, file); return { error: null } } }) } })
