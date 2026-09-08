import {
  DEFAULT_GOALS,
  shiftDay,
  type Workspace,
  type Entry,
} from '../lib/health.ts';
import { workspaceMutation } from '../lib/workspace.ts';
import { database, hash, ApiError } from './runtime';

export async function getWorkspace(user: string, day: string) {
  const result = await database().batch([
    database()
      .prepare(
        'SELECT goals,demo,motion FROM workspace_preferences WHERE user_id=?',
      )
      .bind(user),
    database()
      .prepare(
        "SELECT payload FROM manual_entries WHERE user_id=? AND day>=? AND day<=? ORDER BY day,json_extract(payload,'$.time'),id",
      )
      .bind(user, shiftDay(day, -6), day),
  ]);
  const p = result[0].results[0] as
    | { goals: string; demo: number; motion: number }
    | undefined;
  const workspace: Workspace = {
    version: 1,
    goals: p ? JSON.parse(p.goals) : DEFAULT_GOALS,
    demo: !!p?.demo,
    motion: p ? !!p.motion : true,
    entries: result[1].results.map(
      (r) => JSON.parse(String((r as { payload: string }).payload)) as Entry,
    ),
  };
  return { accountId: user, workspace };
}
export async function mutateWorkspace(user: string, input: unknown) {
  let mutation;
  try {
    mutation = workspaceMutation(input);
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Check your entry.');
  }
  const { id, action } = mutation;
  const db = database();
  const fingerprint = await hash(JSON.stringify(action));
  const guard =
    'NOT EXISTS(SELECT 1 FROM workspace_receipts WHERE user_id=? AND id=?)';
  const receipt = () =>
    db
      .prepare(
        'SELECT fingerprint FROM workspace_receipts WHERE user_id=? AND id=?',
      )
      .bind(user, id)
      .first<{ fingerprint: string }>();
  const existing = await receipt();
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      throw new ApiError('This save has changed. Start a new save.', 409);
    return { saved: true };
  }
  const statements: D1PreparedStatement[] = [];
  if (action.type === 'remove')
    statements.push(
      db
        .prepare(
          `DELETE FROM manual_entries WHERE user_id=? AND id=? AND ${guard}`,
        )
        .bind(user, action.id, user, id),
    );
  if (action.type === 'add' || action.type === 'import') {
    for (const e of action.type === 'add' ? [action.entry] : action.entries)
      statements.push(
        db
          .prepare(
            `INSERT INTO manual_entries(user_id,id,day,payload) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(user_id,id) ${action.type === 'import' ? 'DO NOTHING' : 'DO UPDATE SET day=excluded.day,payload=excluded.payload'}`,
          )
          .bind(user, e.id, e.day, JSON.stringify(e), user, id),
      );
    statements.push(
      db
        .prepare(
          `INSERT INTO workspace_preferences(user_id,goals,demo,motion) SELECT ?,?,0,1 WHERE ${guard} ON CONFLICT(user_id) DO UPDATE SET demo=0`,
        )
        .bind(user, JSON.stringify(DEFAULT_GOALS), user, id),
    );
  }
  if (action.type === 'preferences')
    statements.push(
      db
        .prepare(
          `INSERT INTO workspace_preferences(user_id,goals,demo,motion) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(user_id) DO UPDATE SET goals=COALESCE(?,workspace_preferences.goals),demo=COALESCE(?,workspace_preferences.demo),motion=COALESCE(?,workspace_preferences.motion)`,
        )
        .bind(
          user,
          JSON.stringify(action.goals || DEFAULT_GOALS),
          action.demo ? 1 : 0,
          action.motion === false ? 0 : 1,
          user,
          id,
          action.goals ? JSON.stringify(action.goals) : null,
          action.demo === undefined ? null : Number(action.demo),
          action.motion === undefined ? null : Number(action.motion),
        ),
    );
  statements.push(
    db
      .prepare(
        'INSERT INTO workspace_receipts(user_id,id,fingerprint) VALUES (?,?,?) ON CONFLICT(user_id,id) DO NOTHING',
      )
      .bind(user, id, fingerprint),
  );
  await db.batch(statements);
  if ((await receipt())?.fingerprint !== fingerprint)
    throw new ApiError('This save has changed. Start a new save.', 409);
  return { saved: true };
}
