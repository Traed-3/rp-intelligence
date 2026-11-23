// ============================================================
// Training (Trae, 11/23/26): company training videos, starting with the DOT pre-trip inspection.
// One entry per video. The files live in the private Supabase bucket TRAINING_BUCKET (the same private bucket as
// Technical Help, under training-<slug>/) and are only ever handed out as short-lived signed links to someone
// who is signed in (app/(app)/training/*).
// To add a video: `node scripts/upload-help-files.mjs training-<slug> --video file.mp4 --poster file.jpg`,
// then add an entry here.
// ============================================================

import { HELP_BUCKET } from '@/lib/help'

export const TRAINING_BUCKET = HELP_BUCKET

export type TrainingVideo = {
  slug: string
  title: string
  /** One line for the tile on /training. */
  summary: string
  /** Who it is for, shown as a small tag. */
  audience: string
  /** Paths inside TRAINING_BUCKET. */
  video: { path: string; poster?: string; length: string }
  /** Parts of the video a person can jump to. `at` is seconds from the start. */
  chapters: { at: number; label: string }[]
  /** A form in the app that goes with the video (shown only to people who may open it). */
  form?: { href: string; label: string }
}

export const TRAINING_VIDEOS: TrainingVideo[] = [
  {
    slug: 'pre-trip-inspection',
    title: 'DOT Pre-Trip Inspection',
    summary: 'The Rappahannock Petroleum pre-trip inspection for our non-CDL trucks and trailers, in the same nine steps as the checklist in your cab.',
    audience: 'Everyone who drives an RP truck',
    video: { path: 'training-pre-trip-inspection/video.mp4', poster: 'training-pre-trip-inspection/poster.jpg', length: '10:13' },
    chapters: [
      { at: 0, label: 'Before you start' },
      { at: 35, label: 'Step 1: Approach' },
      { at: 97, label: 'Step 2: Engine compartment' },
      { at: 135, label: 'Step 3: Cab and start-up' },
      { at: 190, label: 'Step 4: Lights' },
      { at: 226, label: 'Step 5: Walkaround' },
      { at: 289, label: 'Step 6: Trailer and coupling' },
      { at: 386, label: 'Step 7: Load securement' },
      { at: 456, label: 'Step 8: Emergency equipment' },
      { at: 492, label: 'Step 9: Brake check' },
      { at: 578, label: 'If a DOT officer stops you' },
    ],
    form: { href: '/forms/pre-trip', label: 'Fill out a Pre-Trip Inspection' },
  },
]

export const trainingVideoBySlug = (slug: string) => TRAINING_VIDEOS.find(v => v.slug === slug)

/** 97 -> "1:37" */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
