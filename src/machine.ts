/**
 * The permit workflow, declared once.
 *
 * This object is the single source of truth. It compiles to database
 * constraints (see compile.ts), to the department queue definitions, and to the
 * citizen-facing "what happens next" copy. Nothing in the system is allowed to
 * know the process independently of this declaration.
 */

export type State =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PLANNING_REVIEW'
  | 'FIRE_REVIEW'
  | 'AWAITING_APPLICANT'
  | 'APPROVED'
  | 'INSPECTION_SCHEDULED'
  | 'INSPECTION_PASSED'
  | 'ISSUED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type Department = 'APPLICANT' | 'PLANNING' | 'FIRE' | 'INSPECTIONS' | 'CLERK';

export interface Transition {
  readonly from: State;
  readonly to: State;
  readonly event: string;
  readonly actor: Department;
  /** Citizen-facing description, generated into the public status page. */
  readonly publicCopy: string;
  /** Target working days in this state before an SLA breach. */
  readonly slaDays?: number;
}

export const STATES: readonly State[] = [
  'DRAFT', 'SUBMITTED', 'PLANNING_REVIEW', 'FIRE_REVIEW', 'AWAITING_APPLICANT',
  'APPROVED', 'INSPECTION_SCHEDULED', 'INSPECTION_PASSED', 'ISSUED',
  'REJECTED', 'WITHDRAWN',
];

export const TERMINAL: readonly State[] = ['ISSUED', 'REJECTED', 'WITHDRAWN'];

export const TRANSITIONS: readonly Transition[] = [
  { from: 'DRAFT', to: 'SUBMITTED', event: 'submit', actor: 'APPLICANT',
    publicCopy: 'Your application has been received.' },
  { from: 'SUBMITTED', to: 'PLANNING_REVIEW', event: 'assign_planning',
    actor: 'CLERK', publicCopy: 'Planning is reviewing your application.',
    slaDays: 10 },
  { from: 'PLANNING_REVIEW', to: 'AWAITING_APPLICANT', event: 'request_info',
    actor: 'PLANNING', publicCopy: 'We need more information from you.',
    slaDays: 5 },
  { from: 'AWAITING_APPLICANT', to: 'PLANNING_REVIEW', event: 'provide_info',
    actor: 'APPLICANT', publicCopy: 'Planning is reviewing your response.',
    slaDays: 10 },
  { from: 'PLANNING_REVIEW', to: 'FIRE_REVIEW', event: 'planning_clear',
    actor: 'PLANNING', publicCopy: 'Fire safety is reviewing your application.',
    slaDays: 10 },
  { from: 'PLANNING_REVIEW', to: 'REJECTED', event: 'planning_reject',
    actor: 'PLANNING', publicCopy: 'Your application was not approved.' },
  { from: 'FIRE_REVIEW', to: 'APPROVED', event: 'fire_clear', actor: 'FIRE',
    publicCopy: 'Your application is approved. Book an inspection.', slaDays: 10 },
  { from: 'FIRE_REVIEW', to: 'REJECTED', event: 'fire_reject', actor: 'FIRE',
    publicCopy: 'Your application was not approved.' },
  { from: 'APPROVED', to: 'INSPECTION_SCHEDULED', event: 'book_inspection',
    actor: 'APPLICANT', publicCopy: 'Your inspection is booked.', slaDays: 20 },
  { from: 'INSPECTION_SCHEDULED', to: 'INSPECTION_PASSED', event: 'inspection_pass',
    actor: 'INSPECTIONS', publicCopy: 'Your inspection passed.', slaDays: 3 },
  { from: 'INSPECTION_SCHEDULED', to: 'APPROVED', event: 'inspection_fail',
    actor: 'INSPECTIONS', publicCopy: 'Your inspection failed. Rebook when ready.' },
  { from: 'INSPECTION_PASSED', to: 'ISSUED', event: 'issue', actor: 'CLERK',
    publicCopy: 'Your permit has been issued.', slaDays: 2 },
  { from: 'DRAFT', to: 'WITHDRAWN', event: 'withdraw', actor: 'APPLICANT',
    publicCopy: 'You withdrew this application.' },
  { from: 'SUBMITTED', to: 'WITHDRAWN', event: 'withdraw', actor: 'APPLICANT',
    publicCopy: 'You withdrew this application.' },
  { from: 'PLANNING_REVIEW', to: 'WITHDRAWN', event: 'withdraw', actor: 'APPLICANT',
    publicCopy: 'You withdrew this application.' },
];

/** Every (from,to) pair that is NOT declared above. The illegal state space. */
export function illegalPairs(): Array<{ from: State; to: State }> {
  const legal = new Set(TRANSITIONS.map((t) => `${t.from}>${t.to}`));
  const out: Array<{ from: State; to: State }> = [];
  for (const from of STATES) {
    for (const to of STATES) {
      if (from === to) continue;
      if (!legal.has(`${from}>${to}`)) out.push({ from, to });
    }
  }
  return out;
}

/** Generated citizen copy - the public page cannot drift from the engine. */
export function nextSteps(state: State): string[] {
  return TRANSITIONS.filter((t) => t.from === state).map((t) => t.publicCopy);
}
