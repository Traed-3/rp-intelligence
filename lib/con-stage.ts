/** Construction job stages as the Service Dispatch screens need them. Pure data — safe in client components. */

/** Stages meaning the physical work is finished (close-out and invoicing are paperwork). */
export const CON_DONE_STAGES = ['close_out', 'invoicing', 'complete'] as const
/** Stages meaning crews are actively on it. */
export const CON_ACTIVE_STAGES = ['in_progress'] as const

export const CON_STAGE_LABEL: Record<string, string> = {
  survey: 'Survey', permitting: 'Permitting', quoting: 'Quoting', material_ordering: 'Ordering materials',
  needs_scheduled: 'Needs scheduled', scheduled: 'Scheduled', in_progress: 'In progress', on_hold: 'On hold',
  return_needed: 'Return needed', close_out: 'Close-out', invoicing: 'Invoicing', complete: 'Complete',
  overspill_program: 'Overspill program',
}

export type ConstructionTag = { jobId: string; jobNumber: string | null; stage: string }
