
**Stellron’s Blacklist Bot — Security Policy (v2.0)**

---

## 1. Sensitive Data Protection

* Bot tokens and credentials are **never hardcoded**. They are stored as environment variables (`TOKEN`, `CLIENT_ID`, `GUILD_ID`) managed through Railway.
* Only authorized hosting configurations can update environment variables. Users cannot change them manually.
* All user data (IDs, blacklists, strikes, appeals, evidence) is stored securely in SQLite.
* Backups (CSV/TXT) must be stored safely; never share publicly.

---

## 2. Access & Permissions

* Commands are restricted to roles **above the bot** in Discord hierarchy.
* Role hierarchy protection prevents staff from blacklisting or striking members with equal/higher roles.
* Only approved moderators can manage blacklists or strikes.
* Immutable audit logs ensure staff cannot tamper with past actions.

---

## 3. Logging & Auditing

* Every action (add, edit, remove) is logged in a dedicated log channel.
* Logs include: user, moderator, reason, category, evidence, expiry, timestamp, and case ID.
* Appeal outcomes store the decision reason, maintaining full audit trail.

---

## 4. Command Safety

* Sensitive commands (`/blacklist add`, `/strike threshold`) are restricted to staff roles.
* Inputs are validated to prevent injection attacks, malformed data, or errors.
* Duplicate blacklist prevention ensures accidental overwrites do not occur.

---

## 5. External Data & Evidence

* Evidence can include URLs or file attachments.
* Only trusted links and attachments should be submitted.
* The bot **does not execute external scripts** from evidence; it only stores and logs them.

---

## 6. Incident Response

* If a **token leak or data breach** occurs:

  1. Immediately regenerate the bot token.
  2. Update Railway environment variables.
  3. Notify server owners/staff of affected data.
  4. Review audit logs for suspicious activity.

---

## 7. Updates & Maintenance

* Only approved maintainers can push updates to the bot.
* All database or command logic changes are reviewed before deployment.
* Upgrades (v2 → v3) must maintain **backward compatibility** and preserve security.

---

## 8. Best Practices

* Regularly monitor bot logs for unexpected activity.
* Backups of blacklists, strikes, and appeals should remain secure.
* Educate staff on **proper use of moderation commands**.
* Use structured logs and audit trails to detect abuse or mistakes.

---
