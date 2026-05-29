const Database = require('better-sqlite3');
const assert = require('node:assert');
const test = require('node:test');

/**
 * Regression test for commit 180201b ("fixed escaped backtick").
 *
 * The bug: the duplicate-category cleanup query used a template literal
 * (backtick string) whose backticks were escaped at build/deploy time,
 * turning the SQL into a broken string literal. Duplicate default
 * categories were therefore never removed.
 *
 * The fix replaced the template literal with a regular double-quoted string.
 */

let db;

function setupSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      guildId   TEXT,
      name      TEXT NOT NULL,
      color     TEXT NOT NULL DEFAULT '#e84142',
      isDefault INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
  `);
}

function seedDefaults(db) {
  const insert = db.prepare(
    "INSERT INTO categories (guildId, name, color, isDefault, createdAt) VALUES (?, ?, ?, 1, ?)"
  );
  const now = new Date().toISOString();
  insert.run(null, 'Appealable',     '#faa61a', now);
  insert.run(null, 'Non-Appealable', '#e84142', now);
  insert.run(null, 'Temporary',      '#5e80eb', now);
  insert.run(null, 'Scam',           '#e74c3c', now);
  insert.run(null, 'Harassment',     '#e67e22', now);
  insert.run(null, 'Raid',           '#9b59b6', now);
  insert.run(null, 'NSFW',           '#e91e63', now);
}

function runDeduplication(db) {
  // This is the exact query from the fix (regular string, not a template literal).
  db.prepare(
    "DELETE FROM categories WHERE id NOT IN (SELECT MIN(id) FROM categories GROUP BY name, COALESCE(guildId, 'null'))"
  ).run();
}

test('duplicate default categories are removed by deduplication query', () => {
  db = new Database(':memory:');
  setupSchema(db);

  // Seed defaults twice to simulate the bug scenario where duplicates accumulate
  seedDefaults(db);
  seedDefaults(db);

  const before = db.prepare("SELECT COUNT(*) as c FROM categories WHERE isDefault = 1").get();
  assert.strictEqual(before.c, 14, 'should have 14 rows (7 defaults inserted twice)');

  runDeduplication(db);

  const after = db.prepare("SELECT COUNT(*) as c FROM categories WHERE isDefault = 1").get();
  assert.strictEqual(after.c, 7, 'duplicates should be removed, leaving exactly 7 defaults');

  // Verify each default category has exactly one row
  const names = ['Appealable', 'Non-Appealable', 'Temporary', 'Scam', 'Harassment', 'Raid', 'NSFW'];
  for (const name of names) {
    const count = db.prepare("SELECT COUNT(*) as c FROM categories WHERE name = ? AND isDefault = 1").get(name);
    assert.strictEqual(count.c, 1, `expected exactly 1 row for "${name}"`);
  }
  db.close();
});

test('deduplication preserves the earliest (lowest id) row', () => {
  db = new Database(':memory:');
  setupSchema(db);
  seedDefaults(db);

  // Record original ids
  const originals = db.prepare("SELECT id, name FROM categories ORDER BY id").all();

  // Insert a second round of duplicates
  seedDefaults(db);

  runDeduplication(db);

  // The surviving rows should have the same ids as the first insert
  const survivors = db.prepare("SELECT id, name FROM categories ORDER BY id").all();
  assert.strictEqual(survivors.length, originals.length);
  for (let i = 0; i < originals.length; i++) {
    assert.strictEqual(survivors[i].id, originals[i].id,
      `surviving id for "${originals[i].name}" should be the original`);
  }
  db.close();
});

test('deduplication handles guild-specific categories separately', () => {
  db = new Database(':memory:');
  setupSchema(db);
  seedDefaults(db); // global defaults (guildId = null)

  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO categories (guildId, name, color, isDefault, createdAt) VALUES (?, ?, ?, 0, ?)"
  ).run('guild-123', 'Scam', '#ff0000', now);

  // Add a duplicate of the guild-specific category
  db.prepare(
    "INSERT INTO categories (guildId, name, color, isDefault, createdAt) VALUES (?, ?, ?, 0, ?)"
  ).run('guild-123', 'Scam', '#ff0000', now);

  const beforeGuild = db.prepare(
    "SELECT COUNT(*) as c FROM categories WHERE guildId = 'guild-123' AND name = 'Scam'"
  ).get();
  assert.strictEqual(beforeGuild.c, 2, 'should have 2 guild-specific Scam rows before dedup');

  runDeduplication(db);

  // Global default "Scam" should still exist
  const globalScam = db.prepare(
    "SELECT COUNT(*) as c FROM categories WHERE guildId IS NULL AND name = 'Scam' AND isDefault = 1"
  ).get();
  assert.strictEqual(globalScam.c, 1, 'global default Scam should survive');

  // Guild-specific "Scam" should have exactly 1 row
  const guildScam = db.prepare(
    "SELECT COUNT(*) as c FROM categories WHERE guildId = 'guild-123' AND name = 'Scam'"
  ).get();
  assert.strictEqual(guildScam.c, 1, 'guild-specific duplicate should be removed');

  db.close();
});

test('broken template-literal query fails to remove duplicates (pre-fix behavior)', () => {
  db = new Database(':memory:');
  setupSchema(db);
  seedDefaults(db);
  seedDefaults(db);

  // Simulate the pre-fix code: a template literal whose backtick was escaped.
  // When the backtick was escaped the runtime received a literal backslash-backtick
  // instead of the template boundary, producing invalid SQL.  We replicate the
  // effect by showing that a syntactically broken query throws, proving the
  // original code path could not clean duplicates.
  const brokenSql = "DELETE FROM categories WHERE id NOT IN (\n" +
    "      SELECT MIN(id) FROM categories GROUP BY name, COALESCE(guildId, \\'null\\')\n" +
    "    )";

  let threw = false;
  try {
    db.prepare(brokenSql).run();
  } catch {
    threw = true;
  }
  assert.ok(threw, 'the pre-fix escaped-backtick query should produce a SQL error');

  // Duplicates remain because the broken query could not execute
  const stillDuped = db.prepare("SELECT COUNT(*) as c FROM categories WHERE isDefault = 1").get();
  assert.strictEqual(stillDuped.c, 14, 'duplicates should still be present after broken query');

  db.close();
});
