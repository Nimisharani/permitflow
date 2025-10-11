/**
 * The 60-second artefact: the illegal state space, and what happens when you
 * try to write into it from outside the application. Run: `npm run demo`
 */
import {
  createDatabase, createApplication, applyTransition, currentState,
} from './compile.ts';
import { TRANSITIONS, STATES, illegalPairs, nextSteps } from './machine.ts';

const illegal = illegalPairs();
const legal = TRANSITIONS.length;

console.log('\n  PERMITFLOW - the statechart is compiled into the database');
console.log('  ' + '-'.repeat(64));
console.log(`  states: ${STATES.length}   declared transitions: ${legal}   ` +
            `illegal pairs: ${illegal.length}`);
console.log(`  the illegal space is ${(illegal.length / legal).toFixed(1)}x larger ` +
            `than the legal one\n`);

// 1. A normal application progresses.
const db = createDatabase();
const id = createApplication(db, 'BLD-2026-0042');
const path = [
  ['DRAFT', 'SUBMITTED', 'submit', 'APPLICANT'],
  ['SUBMITTED', 'PLANNING_REVIEW', 'assign_planning', 'CLERK'],
  ['PLANNING_REVIEW', 'FIRE_REVIEW', 'planning_clear', 'PLANNING'],
  ['FIRE_REVIEW', 'APPROVED', 'fire_clear', 'FIRE'],
] as const;
console.log('  A normal application:');
for (const [from, to, event, actor] of path) {
  applyTransition(db, id, from, to, event, actor);
  console.log(`    ${String(from).padEnd(16)} -> ${String(to).padEnd(20)} (${event})`);
}
console.log(`\n  Citizen sees: "${nextSteps(currentState(db, id))[0]}"\n`);

// 2. The bypass attempt.
console.log('  Now a bulk import writes straight to the table, no service layer:');
console.log("    INSERT INTO history ... VALUES (DRAFT -> ISSUED)");
try {
  db.exec(`INSERT INTO history
    (application_id, from_state, to_state, event, actor, reason, occurred_at)
    VALUES (${id}, 'DRAFT', 'ISSUED', 'sneaky', 'CLERK', 'bulk import', 0)`);
  console.log('    ACCEPTED - the application is now in an impossible state');
} catch (e) {
  console.log(`    REJECTED by the database: ${(e as Error).message}`);
}
console.log(`    state is still: ${currentState(db, id)}\n`);

// 3. Sweep the whole illegal space.
let rejected = 0;
for (const { from, to } of illegal) {
  const d = createDatabase();
  const a = createApplication(d, `${from}-${to}`);
  try {
    applyTransition(d, a, from, to, 'forced', 'CLERK');
  } catch { rejected++; }
  d.close();
}
console.log(`  Swept all ${illegal.length} illegal pairs: ${rejected} rejected, ` +
            `${illegal.length - rejected} accepted.`);
console.log('  An application cannot reach an impossible state, because the');
console.log('  database will not record how it got there.\n');
db.close();
