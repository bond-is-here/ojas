import { database } from './runtime';

// Whitelisted columns deliberately exclude credentials, tokens and authorization state.
const sections = [
  ['manual_entries', 'id,day,payload'],
  ['workspace_preferences', 'goals,demo,motion'],
  ['workout_sessions', 'id,day,status,version,payload'],
  ['training_preferences', 'preferences'],
  ['source_entries', 'provider,record_id,day,time,type,amount,title'],
  ['source_workouts', 'provider,id,day,payload'],
  ['sync_preferences', 'preferences'],
  ['connections', 'provider,status,last_sync,summary'],
] as const;

export function accountExport(user: string) {
  const db = database();
  const encode = new TextEncoder();
  let section = 0,
    cursor = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encode.encode(
          JSON.stringify({
            kind: 'ojas_export',
            version: 1,
            accountId: user,
            exportedAt: new Date().toISOString(),
            format: 'One JSON object per line',
          }) + '\n',
        ),
      );
    },
    async pull(controller) {
      try {
        while (section < sections.length) {
          const [kind, columns] = sections[section];
          const [page] = await db.batch([
            db
              .prepare(
                `SELECT rowid AS export_cursor,${columns} FROM ${kind} WHERE user_id=? AND rowid>? ORDER BY rowid LIMIT 50`,
              )
              .bind(user, cursor),
          ]);
          if (!page.results.length) {
            section++;
            cursor = 0;
            continue;
          }
          const lines = (page.results as Record<string, unknown>[]).map(
            (row) => {
              const { export_cursor, ...data } = row;
              cursor = Number(export_cursor);
              for (const field of [
                'payload',
                'goals',
                'preferences',
                'summary',
              ])
                if (typeof data[field] === 'string')
                  data[field] = JSON.parse(data[field]);
              return JSON.stringify({ kind, data });
            },
          );
          controller.enqueue(encode.encode(lines.join('\n') + '\n'));
          return;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
