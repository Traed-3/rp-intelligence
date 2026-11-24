import type Anthropic from '@anthropic-ai/sdk'
import { canUseArea } from './access'
import type { AssistantCtx, ToolDef } from './types'
import { maintenanceTools } from './tools/maintenance'
import { constructionTools } from './tools/construction'
import { serviceTools } from './tools/service'
import { officeTools } from './tools/office'
import { everydayTools } from './tools/everyday'

/** Every look-up and change Ask RPS has, across the whole app. */
export const ALL_TOOLS: ToolDef[] = [...everydayTools, ...maintenanceTools, ...constructionTools, ...serviceTools, ...officeTools]

/** May this person use this tool? The area check copies the page rules; `allowed` adds the tool's own rule. */
export function mayUse(tool: ToolDef, ctx: AssistantCtx): boolean {
  return canUseArea(ctx, tool.area) && (tool.allowed ? tool.allowed(ctx) : true)
}

/** The tools this person gets. Anything else is never even offered to the model. */
export function toolsFor(ctx: AssistantCtx): ToolDef[] {
  return ALL_TOOLS.filter(t => mayUse(t, ctx))
}

export function toApiTools(tools: ToolDef[]): Anthropic.Tool[] {
  return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
}

/** Run one tool call. Re-checks permission (never trust that the model only calls what it was given) and never throws. */
export async function runTool(name: string, input: unknown, ctx: AssistantCtx): Promise<string> {
  const tool = ALL_TOOLS.find(t => t.name === name)
  if (!tool) return `Unknown tool: ${name}`
  if (!mayUse(tool, ctx)) return `Not allowed: the person signed in (role "${ctx.role}") cannot open that part of the app, so do not share anything about it.`
  try {
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    return await tool.run(args, ctx)
  } catch (e) {
    console.error('[assistant tool]', name, e)
    return `That look-up failed (${e instanceof Error ? e.message : 'unknown error'}). Tell the person it did not work and suggest the page to check instead.`
  }
}
