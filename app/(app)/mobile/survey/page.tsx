import { redirect } from 'next/navigation'
/** The crew's phone shortcut: the surveys screen is already phone-first. */
export default function MobileSurveyPage() { redirect('/construction/surveys') }
