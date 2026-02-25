# Stellron's Blacklist Bot
A Discord blacklist bot built with discord.js v14 and SQLite.

---

## What it does
- Blacklist members from your server, strip their roles, rename them to `[BLACKLISTED]`, and DM them
- Members can appeal their blacklist
- Staff can issue strikes to members
- Logs everything to a dedicated channel
- Works ONLY in Stellron (For Now)

---

## Setup
1. Clone the repo
2. Run `npm install`
3. Add your token and client ID to `index.js`
4. Run `node deploy-commands.js` to register slash commands
5. Run `node index.js` to start the bot

---

## Commands

### Blacklist
| Command | Description |
|---|---|
| `/blacklist add` | Blacklist a member |
| `/blacklist remove` | Unblacklist a member and restore their roles |
| `/blacklist info` | Look up a blacklist entry |
| `/blacklist list` | Paginated list of all blacklisted members |
| `/blacklist search` | Search blacklists by keyword |
| `/blacklist edit` | Edit the reason or category of a blacklist |
| `/blacklist export` | Download the full BL list as a .txt file |
| `/blacklist setlogchannel` | Set the log channel |
| `/blacklist setstaffrole` | Set the staff role |

### Appeals
| Command | Description |
|---|---|
| `/blacklist appeal` | Submit an appeal |
| `/blacklist appeal-accept` | Accept an appeal |
| `/blacklist appeal-deny` | Deny an appeal |

### Strikes
| Command | Description |
|---|---|
| `/strike add` | Add a strike to a member |
| `/strike remove` | Remove a strike by ID |
| `/strike list` | View all strikes for a member |

---

## Notes
- The `[BLACKLISTED]` role is created automatically on first use
- Blacklisted members who rejoin get the role reapplied automatically
- Temporary blacklists expire automatically
- Appeals have a 7 day cooldown after being denied
- Non-appealable blacklists cannot be appealed
- Only roles above the bot can use commands
