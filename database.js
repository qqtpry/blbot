const Database = require('better-sqlite3');
const db = new Database('./blacklist.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS blacklists (
    userId      TEXT NOT NULL,
    guildId     TEXT NOT NULL,
    reason      TEXT NOT NULL,
    category    TEXT NOT NULL,
    requestedBy TEXT,
    acceptedBy  TEXT NOT NULL,
    roles       TEXT NOT NULL DEFAULT '[]',
    nickname    TEXT,
    expiresAt   TEXT,
    createdAt   TEXT NOT NULL,
    PRIMARY KEY (userId, guildId)
  );

  CREATE TABLE IF NOT EXISTS strikes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    userId      TEXT NOT NULL,
    guildId     TEXT NOT NULL,
    reason      TEXT NOT NULL,
    moderatorId TEXT NOT NULL,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appeals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    userId      TEXT NOT NULL,
    guildId     TEXT NOT NULL,
    reason      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    deniedAt    TEXT,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    guildId     TEXT PRIMARY KEY,
    logChannel  TEXT,
    staffRole   TEXT
  );
`);

module.exports = {
  blacklist: {
    create({ userId, guildId, reason, category, requestedBy, acceptedBy, roles, nickname, expiresAt }) {
      db.prepare(`
        INSERT OR REPLACE INTO blacklists
        (userId, guildId, reason, category, requestedBy, acceptedBy, roles, nickname, expiresAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, guildId, reason, category, requestedBy ?? null, acceptedBy,
             JSON.stringify(roles), nickname ?? null, expiresAt ?? null, new Date().toISOString());
    },
    findOne({ userId, guildId }) {
      const row = db.prepare('SELECT * FROM blacklists WHERE userId = ? AND guildId = ?').get(userId, guildId);
      if (!row) return null;
      return { ...row, roles: JSON.parse(row.roles), createdAt: new Date(row.createdAt), expiresAt: row.expiresAt ? new Date(row.expiresAt) : null };
    },
    delete({ userId, guildId }) {
      db.prepare('DELETE FROM blacklists WHERE userId = ? AND guildId = ?').run(userId, guildId);
    },
    list(guildId) {
      return db.prepare('SELECT * FROM blacklists WHERE guildId = ? ORDER BY createdAt DESC').all(guildId)
        .map(r => ({ ...r, roles: JSON.parse(r.roles), createdAt: new Date(r.createdAt), expiresAt: r.expiresAt ? new Date(r.expiresAt) : null }));
    },
    search(guildId, keyword) {
      return db.prepare("SELECT * FROM blacklists WHERE guildId = ? AND reason LIKE ? ORDER BY createdAt DESC").all(guildId, `%${keyword}%`)
        .map(r => ({ ...r, roles: JSON.parse(r.roles), createdAt: new Date(r.createdAt), expiresAt: r.expiresAt ? new Date(r.expiresAt) : null }));
    },
    update({ userId, guildId, reason, category }) {
      db.prepare('UPDATE blacklists SET reason = COALESCE(?, reason), category = COALESCE(?, category) WHERE userId = ? AND guildId = ?')
        .run(reason ?? null, category ?? null, userId, guildId);
    },
    count(guildId) {
      return db.prepare('SELECT COUNT(*) as c FROM blacklists WHERE guildId = ?').get(guildId).c;
    },
    getExpired() {
      return db.prepare("SELECT * FROM blacklists WHERE expiresAt IS NOT NULL AND expiresAt <= ?").all(new Date().toISOString())
        .map(r => ({ ...r, roles: JSON.parse(r.roles), createdAt: new Date(r.createdAt), expiresAt: new Date(r.expiresAt) }));
    },
    listAll() {
      return db.prepare('SELECT * FROM blacklists').all()
        .map(r => ({ ...r, roles: JSON.parse(r.roles) }));
    },
  },

  strikes: {
    add({ userId, guildId, reason, moderatorId }) {
      db.prepare('INSERT INTO strikes (userId, guildId, reason, moderatorId, createdAt) VALUES (?, ?, ?, ?, ?)')
        .run(userId, guildId, reason, moderatorId, new Date().toISOString());
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
    updateStatus(id, status) {
      const deniedAt = status === 'denied' ? new Date().toISOString() : null;
      db.prepare('UPDATE appeals SET status = ?, deniedAt = COALESCE(?, deniedAt) WHERE id = ?').run(status, deniedAt, id);
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
  },
};
