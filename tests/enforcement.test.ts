import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabase, createApplication, applyTransition, currentState,
} from '../src/compile.ts';
import {
  TRANSITIONS, STATES, illegalPairs, nextSteps, type State,
} from '../src/machine.ts';

/** Drive an application to `target` using only declared transitions. */
function driveTo(db: ReturnType<typeof createDatabase>, id: number, target: State) {
  if (target === 'DRAFT') return true;
  const seen = new Set<State>(['DRAFT']);
  let path: State[] | null = null;
  const queue: State[][] = [['DRAFT']];
  while (queue.length) {
    const p = queue.shift()!;
    const last = p[p.length - 1]!;
    if (last === target) { path = p; break; }
    for (const t of TRANSITIONS) {
      if (t.from === last && !seen.has(t.to)) {
        seen.add(t.to);
        queue.push([...p, t.to]);
      }
    }
  }
  if (!path) return false;
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!, to = path[i]!;
    const t = TRANSITIONS.find((x) => x.from === from && x.to === to)!;
    applyTransition(db, id, from, to, t.event, t.actor);
  }
  return true;
}

describe('the database rejects illegal transitions', () => {
  test('THE BYPASS TEST: raw SQL cannot create an illegal state', () => {
    // This is the test that proves the guarantee is not a property of the
    // TypeScript. It writes straight to the table, exactly as a bulk import or
    // an admin script would, with no service layer in the call stack at all.
    const db = createDatabase();
    const id = createApplication(db, 'BYPASS-001');

    assert.throws(
      () => db.exec(`
        INSERT INTO history
          (application_id, from_state, to_state, event, actor, reason, occurred_at)
        VALUES (${id}, 'DRAFT', 'ISSUED', 'sneaky', 'CLERK', 'bulk import', 0)
      `),
      /illegal transition/,
      'raw SQL created DRAFT -> ISSUED; the guarantee is only in application code',
    );
    assert.equal(currentState(db, id), 'DRAFT');
    db.close();
  });

  test('every illegal pair in the state space is rejected', () => {
    const illegal = illegalPairs();
    assert.ok(illegal.length > 80, `expected a large illegal space, got ${illegal.length}`);

    let rejected = 0;
    for (const { from, to } of illegal) {
      const db = createDatabase();
      const id = createApplication(db, `X-${from}-${to}`);
      if (!driveTo(db, id, from)) { db.close(); rejected++; continue; }
      try {
        applyTransition(db, id, from, to, 'forced', 'CLERK');
        assert.fail(`illegal transition ${from} -> ${to} was accepted`);
      } catch (e) {
        assert.match(
          (e as Error).message,
          /illegal transition|terminal state|from_state does not match/,
        );
        rejected++;
      }
      db.close();
    }
    assert.equal(rejected, illegal.length);
  });

  test('a legal edge from the WRONG current state is still rejected', () => {
    // PLANNING_REVIEW -> APPROVED is not declared, but FIRE_REVIEW -> APPROVED
    // is. A writer must not be able to borrow a legal-looking edge.
    const db = createDatabase();
    const id = createApplication(db, 'WRONG-FROM');
    driveTo(db, id, 'PLANNING_REVIEW');
    assert.throws(
      () => applyTransition(db, id, 'FIRE_REVIEW', 'APPROVED', 'fire_clear', 'FIRE'),
      /from_state does not match/,
    );
    db.close();
  });

  test('terminal states are terminal', () => {
    const db = createDatabase();
    const id = createApplication(db, 'TERMINAL');
    driveTo(db, id, 'ISSUED');
    assert.equal(currentState(db, id), 'ISSUED');
    assert.throws(
      () => applyTransition(db, id, 'ISSUED', 'DRAFT', 'reopen', 'CLERK'),
      /terminal state/,
    );
    db.close();
  });

  test('history is append-only, even to raw SQL', () => {
    const db = createDatabase();
    const id = createApplication(db, 'APPEND-ONLY');
    applyTransition(db, id, 'DRAFT', 'SUBMITTED', 'submit', 'APPLICANT');
    assert.throws(() => db.exec("UPDATE history SET to_state = 'ISSUED'"),
      /append-only/);
    assert.throws(() => db.exec('DELETE FROM history'), /append-only/);
    db.close();
  });
});

describe('every declared transition is accepted', () => {
  test('the happy paths work - a gate that denies everything is not a gate', () => {
    let applied = 0;
    for (const t of TRANSITIONS) {
      const db = createDatabase();
      const id = createApplication(db, `OK-${t.from}-${t.to}-${t.event}`);
      if (!driveTo(db, id, t.from)) { db.close(); continue; }
      applyTransition(db, id, t.from, t.to, t.event, t.actor);
      assert.equal(currentState(db, id), t.to);
      applied++;
      db.close();
    }
    assert.ok(applied >= TRANSITIONS.length - 1,
      `only ${applied}/${TRANSITIONS.length} declared transitions were reachable`);
  });

  test('accepted history advances the application state', () => {
    const db = createDatabase();
    const id = createApplication(db, 'ADVANCE');
    applyTransition(db, id, 'DRAFT', 'SUBMITTED', 'submit', 'APPLICANT');
    assert.equal(currentState(db, id), 'SUBMITTED');
    db.close();
  });
});

describe('the citizen view is generated from the same declaration', () => {
  test('next steps for a state match the declared outgoing edges', () => {
    for (const s of STATES) {
      const declared = TRANSITIONS.filter((t) => t.from === s).map((t) => t.publicCopy);
      assert.deepEqual(nextSteps(s), declared,
        `public copy for ${s} drifted from the engine`);
    }
  });

  test('terminal states offer no next steps', () => {
    assert.deepEqual(nextSteps('ISSUED'), []);
    assert.deepEqual(nextSteps('REJECTED'), []);
  });
});
