const Database = require('better-sqlite3');
const db = new Database('./blacklist.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS blacklists (
    caseId      TEXT NOT NULL,
    userId      TEXT NOT NULL,
    guildId     TEXT NOT NULL,
    reason      TEXT NOT NULL,
    category    TEXT NOT NULL,
    requestedBy TEXT,
    acceptedBy  TEXT NOT NULL,
    roles       TEXT NOT NULL DEFAULT '[]',
    nickname    TEXT,
    evidence    TEXT,
    expiresAt   TEXT,
    createdAt   TEXT NOT NULL,
    PRIMARY KEY (userId, guildId)
  );

  CREATE TABLE IF NOT EXISTS blacklist_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    caseId      TEXT NOT NULL,
    guildId     TEXT NOT NULL,
    action      TEXT NOT NULL,
    moderatorId TEXT NOT NULL,
    oldReason   TEXT,
    newReason   TEXT,
    oldCategory TEXT,
    newCategory TEXT,
    note        TEXT,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS strikes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    userId      TEXT NOT NULL,
    guildId     TEXT NOT NULL,
    reason      TEXT NOT NULL,
    moderatorId TEXT NOT NULL,
    caseId      TEXT,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appeals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    userId      TEXT NOT NULL,
    guildId     TEXT NOT NULL,
    reason      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    decidedBy   TEXT,
    decisionReason TEXT,
    deniedAt    TEXT,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId     TEXT,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#e84142',
    isDefault   INTEGER NOT NULL DEFAULT 0,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    guildId         TEXT PRIMARY KEY,
    logChannel      TEXT,
    staffRole       TEXT,
    strikeThreshold INTEGER DEFAULT 0
  );
`);

// Seed default categories if not already present
const existing = db.prepare("SELECT COUNT(*) as c FROM categories WHERE isDefault = 1").get();
if (existing.c === 0) {
  const insert = db.prepare("INSERT INTO categories (guildId, name, color, isDefault, createdAt) VALUES (?, ?, ?, 1, ?)");
  const now = new Date().toISOString();
  insert.run(null, 'Appealable',     '#faa61a', now);
  insert.run(null, 'Non-Appealable', '#e84142', now);
  insert.run(null, 'Temporary',      '#5e80eb', now);
  insert.run(null, 'Scam',           '#e74c3c', now);
  insert.run(null, 'Harassment',     '#e67e22', now);
  insert.run(null, 'Raid',           '#9b59b6', now);
  insert.run(null, 'NSFW',           '#e91e63', now);
} else {
  // Fix colors for existing default categories
  const updates = [
    ['Appealable',     '#faa61a'],
    ['Non-Appealable', '#e84142'],
    ['Temporary',      '#5e80eb'],
    ['Scam',           '#e74c3c'],
    ['Harassment',     '#e67e22'],
    ['Raid',           '#9b59b6'],
    ['NSFW',           '#e91e63'],
  ];
  for (const [name, color] of updates) {
    db.prepare("UPDATE categories SET color = ? WHERE name = ? AND isDefault = 1").run(color, name);
  }
  // Remove duplicates keeping lowest id
  db.prepare("DELETE FROM categories WHERE id NOT IN (SELECT MIN(id) FROM categories GROUP BY name, COALESCE(guildId, 'null'))").run();
}

function generateCaseId() {
  return 'BL-' + Date.now().toString(36).toUpperCase();
}

module.exports = {
  blacklist: {
    create({ userId, guildId, reason, category, requestedBy, acceptedBy, roles, nickname, evidence, expiresAt }) {
      const caseId = generateCaseId();
      db.prepare(`
        INSERT OR REPLACE INTO blacklists
        (caseId, userId, guildId, reason, category, requestedBy, acceptedBy, roles, nickname, evidence, expiresAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(caseId, userId, guildId, reason, category, requestedBy ?? null, acceptedBy,
             JSON.stringify(roles), nickname ?? null, evidence ?? null,
             expiresAt ? expiresAt.toISOString() : null, new Date().toISOString());

      db.prepare(`INSERT INTO blacklist_history (caseId, guildId, action, moderatorId, newReason, newCategory, createdAt)
                  VALUES (?, ?, 'created', ?, ?, ?, ?)`)
        .run(caseId, guildId, acceptedBy, reason, category, new Date().toISOString());

      return caseId;
    },
    findOne({ userId, guildId }) {
      const row = db.prepare('SELECT * FROM blacklists WHERE userId = ? AND guildId = ?').get(userId, guildId);
      if (!row) return null;
      return { ...row, roles: JSON.parse(row.roles), createdAt: new Date(row.createdAt), expiresAt: row.expiresAt ? new Date(row.expiresAt) : null };
    },
    findByCaseId(caseId) {
      const row = db.prepare('SELECT * FROM blacklists WHERE caseId = ?').get(caseId);
      if (!row) return null;
      return { ...row, roles: JSON.parse(row.roles), createdAt: new Date(row.createdAt), expiresAt: row.expiresAt ? new Date(row.expiresAt) : null };
    },
    delete({ userId, guildId, moderatorId, reason }) {
      const entry = db.prepare('SELECT * FROM blacklists WHERE userId = ? AND guildId = ?').get(userId, guildId);
      if (entry) {
        db.prepare(`INSERT INTO blacklist_history (caseId, guildId, action, moderatorId, note, createdAt)
                    VALUES (?, ?, 'removed', ?, ?, ?)`)
          .run(entry.caseId, guildId, moderatorId, reason, new Date().toISOString());
      }
      db.prepare('DELETE FROM blacklists WHERE userId = ? AND guildId = ?').run(userId, guildId);
    },
    list(guildId) {
      return db.prepare('SELECT * FROM blacklists WHERE guildId = ? ORDER BY createdAt DESC').all(guildId)
        .map(r => ({ ...r, roles: JSON.parse(r.roles), createdAt: new Date(r.createdAt), expiresAt: r.expiresAt ? new Date(r.expiresAt) : null }));
    },
    search(guildId, keyword) {
      return db.prepare("SELECT * FROM blacklists WHERE guildId = ? AND reason LIKE ?").all(guildId, `%${keyword}%`)
        .map(r => ({ ...r, roles: JSON.parse(r.roles), createdAt: new Date(r.createdAt), expiresAt: r.expiresAt ? new Date(r.expiresAt) : null }));
    },
    update({ userId, guildId, reason, category, moderatorId }) {
      const entry = db.prepare('SELECT * FROM blacklists WHERE userId = ? AND guildId = ?').get(userId, guildId);
      if (!entry) return;
      db.prepare('UPDATE blacklists SET reason = COALESCE(?, reason), category = COALESCE(?, category) WHERE userId = ? AND guildId = ?')
        .run(reason ?? null, category ?? null, userId, guildId);
      db.prepare(`INSERT INTO blacklist_history (caseId, guildId, action, moderatorId, oldReason, newReason, oldCategory, newCategory, createdAt)
                  VALUES (?, ?, 'edited', ?, ?, ?, ?, ?, ?)`)
        .run(entry.caseId, guildId, moderatorId, entry.reason, reason ?? entry.reason, entry.category, category ?? entry.category, new Date().toISOString());
    },
    count(guildId) {
      return db.prepare('SELECT COUNT(*) as c FROM blacklists WHERE guildId = ?').get(guildId).c;
    },
    getExpired() {
      return db.prepare("SELECT * FROM blacklists WHERE expiresAt IS NOT NULL AND expiresAt <= ?").all(new Date().toISOString())
        .map(r => ({ ...r, roles: JSON.parse(r.roles), createdAt: new Date(r.createdAt), expiresAt: new Date(r.expiresAt) }));
    },
    stats(guildId) {
      const total     = db.prepare('SELECT COUNT(*) as c FROM blacklists WHERE guildId = ?').get(guildId).c;
      const temp      = db.prepare("SELECT COUNT(*) as c FROM blacklists WHERE guildId = ? AND expiresAt IS NOT NULL").get(guildId).c;
      const permanent = total - temp;
      const byCategory = db.prepare('SELECT category, COUNT(*) as c FROM blacklists WHERE guildId = ? GROUP BY category').all(guildId);
      const appealStats = {
        accepted: db.prepare("SELECT COUNT(*) as c FROM appeals WHERE guildId = ? AND status = 'accepted'").get(guildId).c,
        denied:   db.prepare("SELECT COUNT(*) as c FROM appeals WHERE guildId = ? AND status = 'denied'").get(guildId).c,
        pending:  db.prepare("SELECT COUNT(*) as c FROM appeals WHERE guildId = ? AND status = 'pending'").get(guildId).c,
      };
      return { total, temp, permanent, byCategory, appealStats };
    },
    history(caseId) {
      return db.prepare('SELECT * FROM blacklist_history WHERE caseId = ? ORDER BY createdAt ASC').all(caseId);
    },
    extendExpiry({ userId, guildId, newExpiresAt }) {
      db.prepare('UPDATE blacklists SET expiresAt = ? WHERE userId = ? AND guildId = ?')
        .run(newExpiresAt.toISOString(), userId, guildId);
    },
  },

  strikes: {
    add({ userId, guildId, reason, moderatorId, caseId }) {
      db.prepare('INSERT INTO strikes (userId, guildId, reason, moderatorId, caseId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, guildId, reason, moderatorId, caseId ?? null, new Date().toISOString());
    },
    list({ userId, guildId }) {
      return db.prepare('SELECT * FROM strikes WHERE userId = ? AND guildId = ? ORDER BY createdAt DESC').all(userId, guildId)
        .map(r => ({ ...r, createdAt: new Date(r.createdAt) }));
    },
    remove(id) {
      db.prepare('DELETE FROM strikes WHERE id = ?').run(id);
    },
    count({ userId, guildId }) {
      return db.prepare('SELECT COUNT(*) as c FROM strikes WHERE userId = ? AND guildId = ?').get(userId, guildId).c;
    },
  },

  appeals: {
    create({ userId, guildId, reason }) {
      db.prepare('INSERT INTO appeals (userId, guildId, reason, status, createdAt) VALUES (?, ?, ?, ?, ?)')
        .run(userId, guildId, reason, 'pending', new Date().toISOString());
      return db.prepare('SELECT last_insert_rowid() as id').get().id;
    },
    findPending({ userId, guildId }) {
      return db.prepare("SELECT * FROM appeals WHERE userId = ? AND guildId = ? AND status = 'pending'").get(userId, guildId);
    },
    findLastDenied({ userId, guildId }) {
      return db.prepare("SELECT * FROM appeals WHERE userId = ? AND guildId = ? AND status = 'denied' ORDER BY deniedAt DESC LIMIT 1").get(userId, guildId);
    },
    findById(id) {
      return db.prepare('SELECT * FROM appeals WHERE id = ?').get(id);
    },
    updateStatus(id, status, { decidedBy, decisionReason } = {}) {
      const deniedAt = status === 'denied' ? new Date().toISOString() : null;
      db.prepare('UPDATE appeals SET status = ?, decidedBy = ?, decisionReason = ?, deniedAt = COALESCE(?, deniedAt) WHERE id = ?')
        .run(status, decidedBy ?? null, decisionReason ?? null, deniedAt, id);
    },
  },

  categories: {
    list(guildId) {
      return db.prepare('SELECT * FROM categories WHERE isDefault = 1 OR guildId = ? ORDER BY isDefault DESC, name ASC').all(guildId);
    },
    add({ guildId, name, color }) {
      db.prepare('INSERT INTO categories (guildId, name, color, isDefault, createdAt) VALUES (?, ?, ?, 0, ?)')
        .run(guildId, name, color ?? '#e84142', new Date().toISOString());
    },
    remove({ guildId, name }) {
      db.prepare('DELETE FROM categories WHERE guildId = ? AND name = ? AND isDefault = 0').run(guildId, name);
    },
    exists({ guildId, name }) {
      return !!db.prepare('SELECT 1 FROM categories WHERE (isDefault = 1 OR guildId = ?) AND name = ?').get(guildId, name);
    },
  },

  settings: {
    setLogChannel(guildId, channelId) {
      db.prepare('INSERT INTO settings (guildId, logChannel) VALUES (?, ?) ON CONFLICT(guildId) DO UPDATE SET logChannel = ?')
        .run(guildId, channelId, channelId);
    },
    getLogChannel(guildId) {
      return db.prepare('SELECT logChannel FROM settings WHERE guildId = ?').get(guildId)?.logChannel ?? null;
    },
    setStaffRole(guildId, roleId) {
      db.prepare('INSERT INTO settings (guildId, staffRole) VALUES (?, ?) ON CONFLICT(guildId) DO UPDATE SET staffRole = ?')
        .run(guildId, roleId, roleId);
    },
    getStaffRole(guildId) {
      return db.prepare('SELECT staffRole FROM settings WHERE guildId = ?').get(guildId)?.staffRole ?? null;
    },
    setStrikeThreshold(guildId, threshold) {
      db.prepare('INSERT INTO settings (guildId, strikeThreshold) VALUES (?, ?) ON CONFLICT(guildId) DO UPDATE SET strikeThreshold = ?')
        .run(guildId, threshold, threshold);
    },
    getStrikeThreshold(guildId) {
      return db.prepare('SELECT strikeThreshold FROM settings WHERE guildId = ?').get(guildId)?.strikeThreshold ?? 0;
    },
  },
};
