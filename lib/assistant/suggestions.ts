// The example questions shown when Ask RPS opens, picked from the parts of the app this person can open.
// Pure: the (app) layout computes them on the server and hands them to the chat box.

import { areasFor, canWriteTickets, type AssistantArea, type AssistantWho } from './access'

const BY_AREA: Partial<Record<AssistantArea, string[]>> = {
  plate: ["What's on my plate today?"],
  construction: ['What jobs need scheduled?', "What's on the schedule this week?", 'Where is 34006 at?'],
  service: ['Any service calls waiting on a return trip?'],
  billing: ['Which quotes are still waiting on an answer?'],
  compliance: ['Whose DQF items expire in the next 30 days?'],
  inventory: ['Do we have any 1.5" ball valves in stock?'],
  assets: ['What fleet maintenance is due this month?'],
  tickets: ["What's overdue in the shop?"],
  shop: ['Who is clocked in?'],
  sites: ["What's the address of SU-5015?"],
}

export function assistantSuggestions(who: AssistantWho): string[] {
  const out: string[] = []
  for (const area of areasFor(who)) for (const q of BY_AREA[area] ?? []) out.push(q)
  if (canWriteTickets(who)) out.push('Assign the oldest open ticket to me')
  out.push('How do I add the app to my phone?')
  // Keep a mix: no more than five, spread over the list.
  if (out.length <= 5) return out
  const step = out.length / 5
  return Array.from({ length: 5 }, (_, i) => out[Math.floor(i * step)])
}
