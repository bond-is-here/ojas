import {
  DEFAULT_WORKSPACE,
  TYPES,
  validAmount,
  validDay,
  type Entry,
  type Goals,
  type Workspace,
} from './health.ts';

export type WorkspaceAction =
  | { type: 'add'; entry: Entry }
  | { type: 'remove'; id: string }
  | { type: 'preferences'; goals?: Goals; demo?: boolean; motion?: boolean }
  | { type: 'import'; entries: Entry[] };
export type WorkspaceMutation = { id: string; action: WorkspaceAction };
export type AccountWorkspace = { accountId: string; workspace: Workspace };
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
export function manualEntry(input: unknown): Entry {
  if (!input || typeof input !== 'object') throw new Error('Check the entry.');
  const e = input as Entry;
  if (
    !validId(e.id) ||
    !validDay(e.day) ||
    !TYPES.includes(e.type) ||
    !validAmount(e.type, e.amount) ||
    typeof e.title !== 'string' ||
    !e.title.trim() ||
    e.title.length > 100 ||
    typeof e.time !== 'string' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)
  )
    throw new Error('Check the entry amount, date, and label.');
  return {
    id: e.id,
    day: e.day,
    time: e.time,
    type: e.type,
    amount: e.amount,
    title: e.title.trim(),
  };
}
export function workspaceMutation(input: unknown): WorkspaceMutation {
  if (!input || typeof input !== 'object')
    throw new Error('Choose a valid log action.');
  const { id, action } = input as WorkspaceMutation;
  if (!validId(id) || !action || typeof action !== 'object')
    throw new Error('Choose a valid log action.');
  switch (action.type) {
    case 'add':
      return { id, action: { type: 'add', entry: manualEntry(action.entry) } };
    case 'remove':
      if (!validId(action.id)) throw new Error('Choose a valid entry.');
      return { id, action: { type: 'remove', id: action.id } };
    case 'import':
      if (
        !Array.isArray(action.entries) ||
        action.entries.length < 1 ||
        action.entries.length > 100
      )
        throw new Error('Import up to 100 entries at a time.');
      return {
        id,
        action: { type: 'import', entries: action.entries.map(manualEntry) },
      };
    case 'preferences': {
      const next: Extract<WorkspaceAction, { type: 'preferences' }> = {
        type: 'preferences',
      };
      if (action.goals !== undefined) {
        const goals = action.goals;
        if (!goals || TYPES.some((t) => !validAmount(t, goals[t])))
          throw new Error('Check your daily goals.');
        next.goals = Object.fromEntries(
          TYPES.map((t) => [t, goals[t]]),
        ) as Goals;
      }
      for (const key of ['demo', 'motion'] as const)
        if (action[key] !== undefined) {
          if (typeof action[key] !== 'boolean')
            throw new Error('Check your preferences.');
          next[key] = action[key];
        }
      return { id, action: next };
    }
    default:
      throw new Error('Choose a valid log action.');
  }
}
export function applyWorkspaceAction(
  workspace: Workspace,
  action: WorkspaceAction,
): Workspace {
  if (action.type === 'preferences') {
    const { type: _, ...preferences } = action;
    return { ...workspace, ...preferences, version: 1 };
  }
  if (action.type === 'remove')
    return {
      ...workspace,
      entries: workspace.entries.filter((e) => e.id !== action.id),
    };
  const additions = action.type === 'add' ? [action.entry] : action.entries;
  if (action.type === 'import')
    return {
      ...workspace,
      demo: false,
      entries: [
        ...workspace.entries,
        ...additions.filter(
          (entry) =>
            !workspace.entries.some((existing) => existing.id === entry.id),
        ),
      ],
    };
  const ids = new Set(additions.map((e) => e.id));
  return {
    ...workspace,
    demo: false,
    entries: [...workspace.entries.filter((e) => !ids.has(e.id)), ...additions],
  };
}
export function emptyWorkspace(): Workspace {
  return structuredClone(DEFAULT_WORKSPACE);
}
