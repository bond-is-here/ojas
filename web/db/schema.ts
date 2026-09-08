import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
export const connections = sqliteTable(
  'connections',
  {
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    clientId: text('client_id'),
    credentialSource: text('credential_source').notNull().default('personal'),
    secretCipher: text('secret_cipher'),
    tokenCipher: text('token_cipher'),
    expiresAt: integer('expires_at'),
    status: text('status').notNull().default('not_connected'),
    lastSync: text('last_sync'),
    lastError: text('last_error'),
    summary: text('summary'),
    syncUntil: integer('sync_until').notNull().default(0),
    nextSyncAt: integer('next_sync_at').notNull().default(0),
    revision: text('revision').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);
export const oauthStates = sqliteTable('oauth_states', {
  stateHash: text('state_hash').primaryKey(),
  userId: text('user_id').notNull(),
  provider: text('provider').notNull(),
  revision: text('revision').notNull(),
  expiresAt: integer('expires_at').notNull(),
  clientId: text('client_id'),
  credentialSource: text('credential_source'),
});

// Store only hashed app identity and request timing state; never user records or tokens.
export const providerRequestBudget = sqliteTable(
  'provider_request_budget',
  {
    provider: text('provider').notNull(),
    clientIdHash: text('client_id_hash').notNull(),
    blockedUntil: integer('blocked_until').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.provider, t.clientIdHash] })],
);
export const providerRequestLedger = sqliteTable(
  'provider_request_ledger',
  {
    reservationId: text('reservation_id').primaryKey(),
    provider: text('provider').notNull(),
    clientIdHash: text('client_id_hash').notNull(),
    reservedAt: integer('reserved_at').notNull(),
  },
  (t) => [
    index('idx_provider_request_ledger_key_time').on(
      t.provider,
      t.clientIdHash,
      t.reservedAt,
    ),
  ],
);
export const sourceEntries = sqliteTable(
  'source_entries',
  {
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    recordId: text('record_id').notNull(),
    day: text('day').notNull(),
    time: text('time').notNull(),
    type: text('type').notNull(),
    amount: real('amount').notNull(),
    title: text('title').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.provider, t.recordId] }),
    index('idx_source_entries_user_day').on(t.userId, t.day),
  ],
);
export const syncPreferences = sqliteTable('sync_preferences', {
  userId: text('user_id').primaryKey(),
  preferences: text('preferences').notNull(),
});
export const trainingPreferences = sqliteTable('training_preferences', {
  userId: text('user_id').primaryKey(),
  preferences: text('preferences').notNull(),
});
export const workoutSessions = sqliteTable(
  'workout_sessions',
  {
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    day: text('day').notNull(),
    status: text('status').notNull(),
    version: integer('version').notNull(),
    payload: text('payload').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index('idx_workout_sessions_user_day').on(t.userId, t.day),
  ],
);
export const sourceWorkouts = sqliteTable(
  'source_workouts',
  {
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    id: text('id').notNull(),
    day: text('day').notNull(),
    payload: text('payload').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.provider, t.id] }),
    index('idx_source_workouts_user_day').on(t.userId, t.day),
  ],
);
export const manualEntries = sqliteTable(
  'manual_entries',
  {
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    day: text('day').notNull(),
    payload: text('payload').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index('idx_manual_entries_user_day').on(t.userId, t.day),
  ],
);
export const workspacePreferences = sqliteTable('workspace_preferences', {
  userId: text('user_id').primaryKey(),
  goals: text('goals').notNull(),
  demo: integer('demo').notNull().default(0),
  motion: integer('motion').notNull().default(1),
});
export const workspaceReceipts = sqliteTable(
  'workspace_receipts',
  {
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    fingerprint: text('fingerprint').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);
export const appleImportSnapshots = sqliteTable(
  'apple_import_snapshots',
  {
    userId: text('user_id').notNull(),
    type: text('type').notNull(),
    exportedAt: text('exported_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);
