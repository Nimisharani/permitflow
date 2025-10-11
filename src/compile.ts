import { DatabaseSync } from 'node:sqlite';
import { TRANSITIONS, TERMINAL, type State, type Department } from './machine.ts';

/**
 * Compiles the statechart into database objects.
 *
 * It produces a transition table holding the
 * legal edges as DATA, and a trigger that rejects any history row whose
 * (from,to) pair is absent from that table.
 *
 * Why this matters: enforcement in a service layer protects only the code paths
 * that go through the service layer. A bulk import, an admin script, a data-fix
 * migration or a second service will eventually write directly - and on that
 * day an application silently reaches a state the process says is impossible.
 * Here the guarantee is a property of the data store, so the bypass simply
 * fails.
 *
 * The reference target is PostgreSQL; this implementation uses the embedded
 * SQLite in `node:sqlite` so the guarantee is executable with no install.
 */

export function schemaSql(): string {
  return `
CREATE TABLE application (
  id            INTEGER PRIMARY KEY,
  reference     TEXT NOT NULL UNIQUE,
  current_state TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- The legal edges, as data. Generated from machine.ts, never hand-edited.
CREATE TABLE transition (
  from_state TEXT NOT NULL,
  to_state   TEXT NOT NULL,
  event      TEXT NOT NULL,
  actor      TEXT NOT NULL,
  sla_days   INTEGER,
  PRIMARY KEY (from_state, to_state, event)
);

-- Append-only history. The audit trail survives an application bug because
-- the database refuses to rewrite it.
CREATE TABLE history (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES application(id),
  from_state     TEXT NOT NULL,
  to_state       TEXT NOT NULL,
  event          TEXT NOT NULL,
  actor          TEXT NOT NULL,
  reason         TEXT,
  occurred_at    INTEGER NOT NULL
);

-- (1) No history row may describe an edge the statechart does not declare.
CREATE TRIGGER history_transition_must_be_legal
BEFORE INSERT ON history
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM transition t
   WHERE t.from_state = NEW.from_state
     AND t.to_state   = NEW.to_state
     AND t.event      = NEW.event
)
BEGIN
  SELECT RAISE(ABORT, 'illegal transition');
END;

-- (2) The claimed from_state must match the application's actual state, so a
--     writer cannot fabricate a legal-looking edge from the wrong place.
CREATE TRIGGER history_from_state_must_be_current
BEFORE INSERT ON history
FOR EACH ROW
WHEN NEW.from_state <> (
  SELECT current_state FROM application WHERE id = NEW.application_id
)
BEGIN
  SELECT RAISE(ABORT, 'from_state does not match current state');
END;

-- (3) Terminal states are terminal.
CREATE TRIGGER history_terminal_is_final
BEFORE INSERT ON history
FOR EACH ROW
WHEN NEW.from_state IN (${TERMINAL.map((s) => `'${s}'`).join(', ')})
BEGIN
  SELECT RAISE(ABORT, 'application is in a terminal state');
END;

-- (4) History is append-only.
CREATE TRIGGER history_no_update
BEFORE UPDATE ON history
BEGIN
  SELECT RAISE(ABORT, 'history is append-only');
END;

CREATE TRIGGER history_no_delete
BEFORE DELETE ON history
BEGIN
  SELECT RAISE(ABORT, 'history is append-only');
END;

-- (5) Advance the application state as a consequence of accepted history.
CREATE TRIGGER history_advances_application
AFTER INSERT ON history
FOR EACH ROW
BEGIN
  UPDATE application SET current_state = NEW.to_state
   WHERE id = NEW.application_id;
END;
`;
}

/** Materialise the declared edges into the transition table. */
export function seedTransitions(db: DatabaseSync): void {
  const stmt = db.prepare(
    `INSERT INTO transition (from_state, to_state, event, actor, sla_days)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const t of TRANSITIONS) {
    stmt.run(t.from, t.to, t.event, t.actor, t.slaDays ?? null);
  }
}

export function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schemaSql());
  seedTransitions(db);
  return db;
}

export function createApplication(db: DatabaseSync, reference: string): number {
  db.prepare(
    `INSERT INTO application (reference, current_state, created_at)
     VALUES (?, 'DRAFT', ?)`,
  ).run(reference, Date.now());
  const row = db.prepare('SELECT id FROM application WHERE reference = ?')
    .get(reference) as { id: number };
  return row.id;
}

/**
 * The application-layer path. Note that it performs NO validation of its own:
 * it hands the transition to the database and lets the triggers decide. That is
 * deliberate - if this function validated, the tests could not distinguish
 * "the database enforces it" from "this function does".
 */
export function applyTransition(
  db: DatabaseSync,
  applicationId: number,
  from: State,
  to: State,
  event: string,
  actor: Department,
  reason: string | null = null,
): void {
  db.prepare(
    `INSERT INTO history
       (application_id, from_state, to_state, event, actor, reason, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(applicationId, from, to, event, actor, reason, Date.now());
}

export function currentState(db: DatabaseSync, applicationId: number): State {
  const row = db.prepare('SELECT current_state FROM application WHERE id = ?')
    .get(applicationId) as { current_state: State };
  return row.current_state;
}
