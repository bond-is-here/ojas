import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  balance,
  DEFAULT_WORKSPACE,
  entriesForDay,
  formatTime,
  parseWorkspace,
  sampleEntries,
  shiftDay,
  totals,
  validAmount,
  validDay,
  type Entry,
} from '../lib/health.ts';
const today = '2026-09-05';
const entry: Entry = {
  id: 'personal-1',
  day: today,
  time: '10:30',
  type: 'water',
  amount: 250,
  title: 'Water after a walk',
};
await test('personal entries stay isolated by date and survive switching off samples', () => {
  const w = { ...DEFAULT_WORKSPACE, demo: true, entries: [entry] };
  assert.equal(totals(entriesForDay(w, today, today)).water, 1750);
  assert.deepEqual(entriesForDay({ ...w, demo: false }, today, today), [entry]);
  assert.deepEqual(
    entriesForDay({ ...w, demo: false }, shiftDay(today, -1), today),
    [],
  );
  assert.equal(w.entries.length, 1);
});
await test('new accounts start empty and personal totals contain no sample data', () => {
  assert.equal(DEFAULT_WORKSPACE.demo, false);
  assert.deepEqual(entriesForDay(DEFAULT_WORKSPACE, today, today), []);
  assert.equal(
    totals(
      entriesForDay({ ...DEFAULT_WORKSPACE, entries: [entry] }, today, today),
    ).water,
    250,
  );
});
await test('sample history has no future records and all totals match the daily log', () => {
  assert.deepEqual(sampleEntries(shiftDay(today, 1), today), []);
  assert.deepEqual(totals(sampleEntries(today, today)), {
    activity: 6420,
    nutrition: 1640,
    water: 1500,
    sleep: 7.5,
  });
});
await test('goal score cannot be inflated by over-completing a single goal', () => {
  assert.equal(
    balance(
      { activity: 16000, nutrition: 0, water: 0, sleep: 0 },
      DEFAULT_WORKSPACE.goals,
    ),
    25,
  );
  assert.equal(balance(DEFAULT_WORKSPACE.goals, DEFAULT_WORKSPACE.goals), 100);
  assert.equal(
    balance(
      { activity: 0, nutrition: 0, water: 0, sleep: 0 },
      DEFAULT_WORKSPACE.goals,
    ),
    0,
  );
});
await test('calendar arithmetic handles leap years, month boundaries, and daylight saving dates', () => {
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2026-03-08', 1), '2026-03-09');
  assert.equal(validDay('2026-02-30'), false);
  assert.equal(validDay('2024-02-29'), true);
  assert.equal(formatTime('00:05'), '12:05 AM');
  assert.equal(formatTime('12:30'), '12:30 PM');
});
await test('saved workspace round-trips without losing real entries', () => {
  const w = { ...DEFAULT_WORKSPACE, demo: false, entries: [entry] };
  assert.deepEqual(parseWorkspace(JSON.stringify(w)), w);
});
await test('corrupt and impossible saved records are rejected instead of silently trusted', () => {
  for (const amount of [-1, 0, Infinity, 0.5])
    assert.equal(validAmount('water', amount), false);
  assert.equal(validAmount('sleep', 7.5), true);
  assert.equal(validAmount('sleep', 7.1), false);
  assert.equal(validAmount('sleep', 25), false);
  assert.throws(() => parseWorkspace('{broken'));
  assert.throws(() =>
    parseWorkspace(
      JSON.stringify({ ...DEFAULT_WORKSPACE, entries: [entry, entry] }),
    ),
  );
  assert.throws(() =>
    parseWorkspace(
      JSON.stringify({
        ...DEFAULT_WORKSPACE,
        entries: [{ ...entry, time: '25:00' }],
      }),
    ),
  );
  assert.throws(() =>
    parseWorkspace(
      JSON.stringify({
        ...DEFAULT_WORKSPACE,
        goals: { ...DEFAULT_WORKSPACE.goals, water: 0 },
      }),
    ),
  );
});
