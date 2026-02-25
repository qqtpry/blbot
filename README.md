# Stelltron BL Bot V2
A Discord blacklist and moderation bot built with discord.js v14 and SQLite.

---

## What it does
- Blacklist members with case IDs, evidence, and categories
- Full audit trail for every blacklist action
- Members can appeal their blacklist
- Staff can issue strikes with auto-blacklist thresholds
- Logs everything to a dedicated channel
- Works across multiple servers

---

## Setup
1. Clone the repo
2. Run `npm install`
3. Set environment variables: `TOKEN`, `CLIENT_ID`, `GUILD_ID`
4. Run `node deploy-commands.js` to register slash commands
5. Run `node index.js` to start the bot

---

## Commands

### Blacklist
| Command | Description |
|---|---|
| `/blacklist add` | Blacklist a member with reason, category, evidence, and optional duration |
| `/blacklist remove` | Unblacklist a member and restore their roles |
| `/blacklist info` | View full blacklist entry with case ID, evidence, expiry countdown |
| `/blacklist history` | View full edit history for a blacklist entry |
| `/blacklist check` | Quick status check for any member |
| `/blacklist stats` | Server-wide blacklist stats |
| `/blacklist list` | Paginated list of all blacklisted members |
| `/blacklist search` | Search blacklists by keyword |
| `/blacklist edit` | Edit reason or category of a blacklist |
| `/blacklist export` | Export full BL list as TXT or CSV |
| `/blacklist setlogchannel` | Set the log channel |
| `/blacklist setstaffrole` | Set the staff role |

### Categories
| Command | Description |
|---|---|
| `/blacklist category-add` | Add a custom category |
| `/blacklist category-remove` | Remove a custom category |
| `/blacklist category-list` | View all categories |

### Appeals
| Command | Description |
|---|---|
| `/blacklist appeal` | Submit an appeal |
| `/blacklist appeal-accept` | Accept an appeal |
| `/blacklist appeal-deny` | Deny an appeal (7 day cooldown) |

### Strikes
| Command | Description |
|---|---|
| `/strike add` | Add a strike to a member |
| `/strike remove` | Remove a strike by ID |
| `/strike list` | View all strikes for a member |
| `/strike threshold` | Set auto-blacklist after X strikes |

---

## Default Categories
- Appealable
- Non-Appealable
- Temporary
- Scam
- Harassment
- Raid
- NSFW

---

## Notes
- Every blacklist gets a unique case ID
- The `[BLACKLISTED]` role is created automatically on first use
- Blacklisted members who rejoin get the role reapplied automatically
- Temporary blacklists expire automatically with countdown display
- Appeals have a 7 day cooldown after being denied
- Strike threshold auto-blacklists members when reached
- Only roles above the bot can use commands
- Full audit trail stored for every blacklist action
