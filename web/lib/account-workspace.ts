import {
  applyWorkspaceAction,
  emptyWorkspace,
  workspaceMutation,
  type AccountWorkspace,
  type WorkspaceAction,
  type WorkspaceMutation,
} from './workspace.ts';
import type { Workspace } from './health.ts';

export type WorkspaceState = {
  workspace: Workspace;
  loaded: boolean;
  saving: boolean;
  pending: boolean;
  error: string;
};
export const initialWorkspaceState = (): WorkspaceState => ({
  workspace: emptyWorkspace(),
  loaded: false,
  saving: false,
  pending: false,
  error: '',
});
type Dependencies = {
  readPending: () => string[];
  writePending: (id: string, value: string | null) => void;
  lock: (run: () => Promise<void>) => Promise<void>;
  read: (day: string) => Promise<AccountWorkspace>;
  send: (mutation: WorkspaceMutation) => Promise<unknown>;
};
// The server owns saved records. The account-scoped outbox contains only an unacknowledged request.
export function createAccountWorkspace(
  accountId: string,
  deps: Dependencies,
  notify: (state: WorkspaceState) => void,
) {
  let state = initialWorkspaceState();
  let day = '';
  let generation = 0;
  const inMemory = new Map<string, WorkspaceMutation>();
  let durable = true;
  let tail = Promise.resolve();
  const emit = (changes: Partial<WorkspaceState>) => {
    state = { ...state, ...changes };
    notify(state);
  };
  const pending = () => {
    try {
      const requests = new Map(inMemory);
      for (const raw of deps.readPending()) {
        const request = workspaceMutation(JSON.parse(raw));
        requests.set(request.id, request);
      }
      return [...requests.values()].sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      throw new Error(
        'A pending save in this browser could not be read. Your account data is safe. Export this browser’s recovery data before clearing it.',
      );
    }
  };
  const persist = (request: WorkspaceMutation, saved = false) => {
    if (saved) inMemory.delete(request.id);
    else inMemory.set(request.id, request);
    try {
      deps.writePending(request.id, saved ? null : JSON.stringify(request));
      durable = true;
    } catch {
      durable = false;
    }
    emit({ pending: inMemory.size > 0 });
  };
  const read = async () => {
    const version = ++generation;
    try {
      const next = await deps.read(day);
      if (generation !== version) return false;
      if (next.accountId !== accountId)
        throw new Error('Your account changed. Reload Ojas to continue.');
      emit({ workspace: next.workspace, loaded: true });
      return true;
    } catch (error) {
      if (generation !== version) return false;
      throw error;
    }
  };
  const perform = async (request: WorkspaceMutation) => {
    persist(request);
    await deps.send(request);
    ++generation;
    emit({ workspace: applyWorkspaceAction(state.workspace, request.action) });
    persist(request, true);
  };
  const work = (action?: WorkspaceAction) => {
    const run = async () => {
      emit({ saving: true, error: '' });
      try {
        await deps.lock(async () => {
          const previous = pending();
          const same =
            action &&
            previous.some(
              (request) =>
                JSON.stringify(request.action) === JSON.stringify(action),
            );
          for (const request of previous) await perform(request);
          if (action && !same)
            await perform(
              workspaceMutation({
                id: `${Date.now()}_${crypto.randomUUID()}`,
                action,
              }),
            );
        });
        try {
          await read();
        } catch {
          emit({
            error:
              'Your change is saved. Refresh to load the latest account history.',
          });
        }
      } catch (e) {
        emit({
          pending: true,
          error: `${e instanceof Error ? e.message : 'Your change could not be saved.'}${!durable && inMemory.size ? ' Keep this tab open: browser storage is unavailable.' : ''}`,
        });
        throw e;
      } finally {
        emit({ saving: false });
      }
    };
    const result = tail.then(run);
    tail = result.catch(() => undefined);
    return result;
  };
  return {
    get pending() {
      return state.pending || state.saving;
    },
    async load(selectedDay: string) {
      day = selectedDay;
      try {
        if (!(await read())) return;
        const request = pending();
        emit({
          pending: request.length > 0,
          error: request.length
            ? 'A previous save is waiting. Retry it to finish saving to your account.'
            : '',
        });
      } catch (e) {
        emit({
          error:
            e instanceof Error ? e.message : 'Your log could not be loaded.',
        });
      }
    },
    mutate: (action: WorkspaceAction) =>
      work(workspaceMutation({ id: crypto.randomUUID(), action }).action),
    retry: () => work(),
  };
}
