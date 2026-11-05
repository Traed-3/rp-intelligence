/**
 * Print the DOT file audit from the command line (same rules as /compliance/audit).
 *   npx tsx --env-file=.env.local scripts/dqf-audit-report.mts [--json]
 */
import { createClient } from '@supabase/supabase-js'
import { loadFiles } from '@/lib/compliance-data'
import { auditAll } from '@/lib/compliance-audit'

const COMPANY_ID = process.env.RPS_COMPANY_ID ?? 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { files } = await loadFiles(admin, COMPANY_ID, { includeInactive: true })
const audits = auditAll(files)
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(audits.map(a => ({ name: a.file.employee.full_name, scope: a.scope, ready: a.ready, findings: a.findings.map(f => ({ s: f.severity, t: f.title })) })), null, 1))
} else {
  for (const a of audits) {
    console.log(`\n${a.file.employee.full_name} [${a.scope}] ${a.ready ? 'READY' : `${a.violations} violations, ${a.warnings} warnings`}`)
    for (const f of a.findings) console.log(`  ${f.severity.padEnd(9)} ${f.title}`)
  }
}
