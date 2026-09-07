import { DEFAULT_WORKSPACE, parseWorkspace, type Workspace } from './health.ts';

type Storage = { read: () => string | null; write: (value: string) => void };
type Lock = (run: () => void) => Promise<void>;
export function createWorkspaceStore(
  storage: Storage,
  notify: (workspace: Workspace, error: string) => void,
  lock: Lock = async (run) => {
    run();
  },
) {
  let workspace = structuredClone(DEFAULT_WORKSPACE);
  let sessionOnly = false;
  let error = '';
  let pending = 0;
  let queue = Promise.resolve();
  const read = () => {
    if (sessionOnly) return;
    try {
      const raw = storage.read();
      workspace = raw
        ? parseWorkspace(raw)
        : structuredClone(DEFAULT_WORKSPACE);
    } catch {
      sessionOnly = true;
      error =
        'Your saved local log could not be read. New manual entries will stay in this session to protect the saved copy.';
    }
  };
  return {
    get pending() {
      return pending > 0;
    },
    load() {
      if (pending) return;
      read();
      notify(workspace, error);
    },
    update(change: (workspace: Workspace) => Workspace) {
      pending++;
      queue = queue
        .then(async () => {
          let applied = false;
          const commit = () => {
            read();
            workspace = change(workspace);
            applied = true;
            if (!sessionOnly) {
              try {
                storage.write(JSON.stringify(workspace));
              } catch {
                sessionOnly = true;
                error =
                  'Browser storage is unavailable. Manual entries will last for this session only.';
              }
            }
            notify(workspace, error);
          };
          try {
            await lock(commit);
          } catch {
            if (!applied) {
              sessionOnly = true;
              error =
                'Browser storage is unavailable. Manual entries will last for this session only.';
              commit();
            }
          }
        })
        .finally(() => {
          pending--;
          if (!pending) {
            read();
            notify(workspace, error);
          }
        });
      return queue;
    },
  };
}
