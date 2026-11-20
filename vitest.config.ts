import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Tests run in plain Node with a stand-in database and a stand-in Gmail (tests/rpmail/fakes.ts).
// Nothing in a test talks to the real Supabase project or to Google.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/rpmail/setup.ts'], testTimeout: 15_000 },
})
