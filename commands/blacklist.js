const {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType
} = require('discord.js');
const db = require('../database');

const APPEAL_COOLDOWN_DAYS = 7;
const PAGE_SIZE = 8;

// ── Permission check ─────────────────────────────────
async function hasPermission(interaction) {
  if (interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const staffRoleId = db.settings.getStaffRole(interaction.guild.id);
  if (staffRoleId && interaction.member.roles.cache.has(staffRoleId)) return true;
  const botMember  = await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember) return false;
  if (interaction.member.roles.highest.comparePositionTo(botMember.roles.highest) > 0) return true;
  return false;
}

// ── Get or create [BLACKLISTED] role ─────────────────
async function getOrCreateBlacklistRole(guild) {
  let role = guild.roles.cache.find(r => r.name === '[BLACKLISTED]');
  if (!role) {
    role = await guild.roles.create({ name: '[BLACKLISTED]', colors: [0x2b2d31], permissions: [], reason: 'Auto-created by BLBot' });
    for (const [, channel] of guild.channels.cache) {
      if (!channel.permissionOverwrites) continue;
      await channel.permissionOverwrites.create(role, {
        SendMessages: false, AddReactions: false, Speak: false, SendMessagesInThreads: false,
      }).catch(() => null);
    }
  }
  return role;
}

// ── Send to log channel ───────────────────────────────
async function sendLog(guild, embed) {
  const channelId = db.settings.getLogChannel(guild.id);
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (channel) await channel.send({ embeds: [embed] }).catch(() => null);
}

// ── Remove BL helper ──────────────────────────────────
async function removeBlacklist(guild, userId, entry, { moderatorId, reason }) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) {
    const blRole     = guild.roles.cache.find(r => r.name === '[BLACKLISTED]');
    const validRoles = entry.roles.filter(id => guild.roles.cache.has(id) && id !== blRole?.id);
    await member.roles.set(validRoles).catch(() => null);
    await member.setNickname(entry.nickname ?? null).catch(() => null);
  }
  db.blacklist.delete({ userId, guildId: guild.id, moderatorId, reason });
  return member;
}

// ── Format expiry countdown ───────────────────────────
function formatExpiry(expiresAt) {
  if (!expiresAt) return 'Never';
  const ms   = expiresAt.getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const d    = Math.floor(ms / 86400000);
  const h    = Math.floor((ms % 86400000) / 3600000);
  const m    = Math.floor((ms % 3600000) / 60000);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ') || '<1m';
}

// ── Parse duration ────────────────────────────────────
function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(d|h|m)$/);
  if (!match) return null;
  const ms = parseInt(match[1]) * ({ d: 86400000, h: 3600000, m: 60000 }[match[2]]);
  return new Date(Date.now() + ms);
}

// ── Paginated list embed ──────────────────────────────
function buildListEmbed(entries, page, totalPages, guild, title) {
  const slice = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const lines = slice.map((e, i) => {
    const num    = page * PAGE_SIZE + i + 1;
    const expiry = e.expiresAt ? ` · ${formatExpiry(e.expiresAt)}` : '';
    return `\`${num}.\` <@${e.userId}> — \`${e.caseId}\`${expiry}\n> ${e.reason} — **${e.category}**`;
  }).join('\n\n');
  return new EmbedBuilder()
    .setColor(0xe84142)
    .setTitle(title ?? `🔨 Blacklisted Members — ${entries.length} total`)
    .setDescription(lines || '*No entries*')
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${guild.name}`, iconURL: guild.iconURL() })
    .setTimestamp();
}

function buildPaginationRow(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
  );
}

// ── Command definition ────────────────────────────────
const data = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Blacklist management')

  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Blacklist a member')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    .addStringOption(o => o.setName('category').setDescription('Category name').setRequired(true))
    .addUserOption(o => o.setName('requested_by').setDescription('Who requested this?'))
    .addStringOption(o => o.setName('duration').setDescription('Duration e.g. 1d, 12h, 30m'))
    .addStringOption(o => o.setName('evidence').setDescription('Evidence links or message URLs (comma separated)')))

  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Remove a blacklist')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('info')
    .setDescription('View a blacklist entry')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('history')
    .setDescription('View full edit history for a blacklist')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('check')
    .setDescription('Quick blacklist status check')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('stats')
    .setDescription('View server blacklist stats'))

  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('List all blacklisted members'))

  .addSubcommand(sub => sub
    .setName('search')
    .setDescription('Search blacklists by keyword')
    .addStringOption(o => o.setName('keyword').setDescription('Search term').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('edit')
    .setDescription('Edit a blacklist entry')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('New reason'))
    .addStringOption(o => o.setName('category').setDescription('New category')))

  .addSubcommand(sub => sub
    .setName('export')
    .setDescription('Export blacklist as txt or csv')
    .addStringOption(o => o.setName('format').setDescription('Export format').setRequired(true)
      .addChoices({ name: 'TXT', value: 'txt' }, { name: 'CSV', value: 'csv' })))

  .addSubcommand(sub => sub
    .setName('appeal')
    .setDescription('Submit an appeal')
    .addStringOption(o => o.setName('reason').setDescription('Why should you be unblacklisted?').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('appeal-accept')
    .setDescription('Accept a blacklist appeal')
    .addIntegerOption(o => o.setName('id').setDescription('Appeal ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('appeal-deny')
    .setDescription('Deny a blacklist appeal')
    .addIntegerOption(o => o.setName('id').setDescription('Appeal ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('category-add')
    .setDescription('Add a custom category')
    .addStringOption(o => o.setName('name').setDescription('Category name').setRequired(true))
    .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #ff0000')))

  .addSubcommand(sub => sub
    .setName('category-remove')
    .setDescription('Remove a custom category')
    .addStringOption(o => o.setName('name').setDescription('Category name').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('category-list')
    .setDescription('View all categories'))

  .addSubcommand(sub => sub
    .setName('setlogchannel')
    .setDescription('Set the log channel')
    .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('setstaffrole')
    .setDescription('Set the staff role')
    .addRoleOption(o => o.setName('role').setDescription('Staff role').setRequired(true)));

// ── /blacklist add ────────────────────────────────────
async function handleAdd(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });

  const target   = interaction.options.getUser('user');
  const reason   = interaction.options.getString('reason');
  const category = interaction.options.getString('category');
  const reqBy    = interaction.options.getUser('requested_by');
  const duration = interaction.options.getString('duration');
  const evidence = interaction.options.getString('evidence');
  const expiresAt = parseDuration(duration);

  if (target.id === interaction.user.id) return interaction.reply({ content: '❌ You cannot blacklist yourself.', ephemeral: true });
  if (target.bot) return interaction.reply({ content: '❌ You cannot blacklist a bot.', ephemeral: true });
  if (duration && !expiresAt) return interaction.reply({ content: '❌ Invalid duration. Use `1d`, `12h`, or `30m`.', ephemeral: true });
  if (!db.categories.exists({ guildId: interaction.guild.id, name: category })) {
    return interaction.reply({ content: `❌ Category \`${category}\` doesn't exist. Use \`/blacklist category-list\` to see available categories.`, ephemeral: true });
  }
  if (db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id })) {
    return interaction.reply({ content: `❌ <@${target.id}> is already blacklisted.`, ephemeral: true });
  }

  const confirmEmbed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('⚠️ Confirm Blacklist')
    .setDescription(`Blacklist <@${target.id}>?`)
    .addFields(
      { name: 'Reason',   value: reason,   inline: true },
      { name: 'Category', value: category, inline: true },
      { name: 'Type',     value: expiresAt ? `⏳ Temporary (${formatExpiry(expiresAt)})` : '🔒 Permanent', inline: true },
      { name: 'Evidence', value: evidence ?? 'None', inline: false },
    )
    .setThumbnail(target.displayAvatarURL({ dynamic: true }));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bl_confirm').setLabel('Confirm').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('bl_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true });

  const collector = interaction.channel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: i => i.user.id === interaction.user.id && ['bl_confirm', 'bl_cancel'].includes(i.customId),
    time: 30_000, max: 1,
  });

  collector.on('collect', async i => {
    if (i.customId === 'bl_cancel') return i.update({ content: '❌ Cancelled.', embeds: [], components: [] });
    await i.update({ content: '⏳ Processing...', embeds: [], components: [] });

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return i.editReply({ content: '❌ Member not found in server.' });

    const roles    = member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.id);
    const nickname = member.nickname ?? null;

    const caseId = db.blacklist.create({
      userId: target.id, guildId: interaction.guild.id, reason, category,
      requestedBy: reqBy?.id, acceptedBy: interaction.user.id,
      roles, nickname, evidence, expiresAt,
    });

    const blRole = await getOrCreateBlacklistRole(interaction.guild);
    await member.roles.set([blRole]).catch(() => null);
    await member.setNickname(`[BLACKLISTED] ${member.user.username}`).catch(() => null);

    let dmStatus = '❌ Could not send';
    try {
      await target.send(`🔨 You have been blacklisted in **${interaction.guild.name}**.\n**Case ID:** \`${caseId}\`\n**Reason:** ${reason}\n**Category:** ${category}${expiresAt ? `\n**Expires in:** ${formatExpiry(expiresAt)}` : ''}`);
      dmStatus = '✉️ Sent';
    } catch (_) {}

    const blCount = db.blacklist.count(interaction.guild.id);

    const embed = new EmbedBuilder()
      .setColor(0xe84142)
      .setTitle('🔨 Member Blacklisted')
      .setDescription(`<@${target.id}> has been blacklisted`)
      .addFields(
        { name: 'Case ID',        value: `\`${caseId}\``,                                   inline: true },
        { name: 'Category',       value: category,                                           inline: true },
        { name: 'DM Status',      value: dmStatus,                                           inline: true },
        { name: 'User',           value: `<@${target.id}>\n\`${target.id}\``,               inline: true },
        { name: 'Accepted By',    value: `<@${interaction.user.id}>`,                       inline: true },
        { name: 'Requested By',   value: reqBy ? `<@${reqBy.id}>` : '*N/A*',                inline: true },
        { name: 'Duration',       value: expiresAt ? formatExpiry(expiresAt) : 'Permanent', inline: true },
        { name: 'Roles Stripped', value: `${roles.length} role(s)`,                         inline: true },
        { name: 'Nickname',       value: `\`[BLACKLISTED] ${member.user.username}\``,       inline: true },
        { name: 'Reason',         value: reason,                                             inline: false },
        { name: 'Evidence',       value: evidence ?? 'None',                                 inline: false },
      )
      .setThumbnail(target.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: `${interaction.guild.name} • Total BLs: ${blCount}`, iconURL: interaction.guild.iconURL() })
      .setTimestamp();

    await i.editReply({ content: '', embeds: [], components: [] });
    await interaction.channel.send({ embeds: [embed] });
    await sendLog(interaction.guild, embed);

    // Check strike threshold
    const threshold = db.settings.getStrikeThreshold(interaction.guild.id);
    const strikes   = db.strikes.count({ userId: target.id, guildId: interaction.guild.id });
    if (threshold > 0 && strikes >= threshold) {
      const thresholdEmbed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle('⚠️ Strike Threshold Reached')
        .setDescription(`<@${target.id}> has **${strikes}** strikes (threshold: ${threshold}). Blacklist auto-created.`)
        .setTimestamp();
      await sendLog(interaction.guild, thresholdEmbed);
    }
  });

  collector.on('end', collected => {
    if (!collected.size) interaction.editReply({ content: '⏰ Timed out.', embeds: [], components: [] }).catch(() => null);
  });
}

// ── /blacklist remove ─────────────────────────────────
async function handleRemove(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  await interaction.deferReply();

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const entry  = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });
  if (!entry) return interaction.editReply({ content: `❌ No blacklist entry found for <@${target.id}>.` });

  await removeBlacklist(interaction.guild, target.id, entry, { moderatorId: interaction.user.id, reason });
  const restoredCount = entry.roles.filter(id => interaction.guild.roles.cache.has(id)).length;
  const blCount = db.blacklist.count(interaction.guild.id);

  let dmStatus = '❌ Could not send';
  try {
    await target.send(`✅ Your blacklist in **${interaction.guild.name}** has been lifted.\n**Case ID:** \`${entry.caseId}\`\n**Reason:** ${reason}`);
    dmStatus = '✉️ Sent';
  } catch (_) {}

  const embed = new EmbedBuilder()
    .setColor(0x3ba55c)
    .setTitle('✅ Member Unblacklisted')
    .setDescription(`<@${target.id}> has been unblacklisted`)
    .addFields(
      { name: 'Case ID',           value: `\`${entry.caseId}\``,                             inline: true },
      { name: 'User',              value: `<@${target.id}>\n\`${target.id}\``,               inline: true },
      { name: 'Responsible Mod',   value: `<@${interaction.user.id}>`,                       inline: true },
      { name: 'DM Status',         value: dmStatus,                                           inline: true },
      { name: 'Roles Restored',    value: `${restoredCount} role(s)`,                        inline: true },
      { name: 'Nickname',          value: entry.nickname ? `Restored to: \`${entry.nickname}\`` : '*Cleared*', inline: true },
      { name: 'Reason',            value: reason,                                             inline: false },
      { name: 'Original Reason',   value: entry.reason,                                       inline: false },
      { name: 'Original Category', value: entry.category,                                     inline: true },
    )
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `${interaction.guild.name} • Total BLs: ${blCount}`, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.guild, embed);
}

// ── /blacklist info ───────────────────────────────────
async function handleInfo(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser('user');
  const entry  = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });
  if (!entry) return interaction.editReply({ content: `✅ <@${target.id}> is not blacklisted.` });

  const strikes = db.strikes.count({ userId: target.id, guildId: interaction.guild.id });

  const embed = new EmbedBuilder()
    .setColor(0x5e80eb)
    .setTitle('📋 Blacklist Info')
    .setDescription(`Active entry for <@${target.id}>`)
    .addFields(
      { name: 'Case ID',        value: `\`${entry.caseId}\``,                              inline: true },
      { name: 'Status',         value: '🔴 Blacklisted',                                   inline: true },
      { name: 'Strikes',        value: `${strikes}`,                                       inline: true },
      { name: 'Category',       value: entry.category,                                     inline: true },
      { name: 'Accepted By',    value: `<@${entry.acceptedBy}>`,                          inline: true },
      { name: 'Requested By',   value: entry.requestedBy ? `<@${entry.requestedBy}>` : '*N/A*', inline: true },
      { name: 'Expires',        value: entry.expiresAt ? `${formatExpiry(entry.expiresAt)} (<t:${Math.floor(entry.expiresAt.getTime()/1000)}:F>)` : 'Never', inline: true },
      { name: 'Blacklisted On', value: `<t:${Math.floor(entry.createdAt.getTime()/1000)}:F>`, inline: true },
      { name: 'Roles Stored',   value: `${entry.roles.length} role(s)`,                   inline: true },
      { name: 'Reason',         value: entry.reason,                                       inline: false },
      { name: 'Evidence',       value: entry.evidence ?? 'None',                           inline: false },
    )
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ── /blacklist history ────────────────────────────────
async function handleHistory(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  await interaction.deferReply({ ephemeral: false });

  const target = interaction.options.getUser('user');
  const entry  = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });
  if (!entry) return interaction.editReply({ content: `❌ No blacklist entry found for <@${target.id}>.` });

  const history = db.blacklist.history(entry.caseId);
  if (!history.length) return interaction.editReply({ content: '❌ No history found.' });

  const lines = history.map(h => {
    const ts   = `<t:${Math.floor(new Date(h.createdAt).getTime()/1000)}:f>`;
    const mod  = `<@${h.moderatorId}>`;
    if (h.action === 'created') return `📝 **Created** by ${mod} — ${ts}\n> Reason: ${h.newReason} | Category: ${h.newCategory}`;
    if (h.action === 'edited')  return `✏️ **Edited** by ${mod} — ${ts}\n> Reason: ~~${h.oldReason}~~ → ${h.newReason}`;
    if (h.action === 'removed') return `🗑️ **Removed** by ${mod} — ${ts}\n> ${h.note}`;
    return `🔹 **${h.action}** by ${mod} — ${ts}`;
  }).join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(0x5e80eb)
    .setTitle(`📜 Blacklist History — \`${entry.caseId}\``)
    .setDescription(lines)
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ── /blacklist check ──────────────────────────────────
async function handleCheck(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const target = interaction.options.getUser('user');
  const entry  = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });
  const strikes = db.strikes.count({ userId: target.id, guildId: interaction.guild.id });

  const embed = new EmbedBuilder()
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  if (!entry) {
    embed.setColor(0x3ba55c).setTitle('✅ Not Blacklisted')
      .setDescription(`<@${target.id}> has no active blacklist in this server.`)
      .addFields({ name: 'Strikes', value: `${strikes}`, inline: true });
  } else {
    embed.setColor(0xe84142).setTitle('🔴 Blacklisted')
      .setDescription(`<@${target.id}> is currently blacklisted.`)
      .addFields(
        { name: 'Case ID',   value: `\`${entry.caseId}\``, inline: true },
        { name: 'Category',  value: entry.category,         inline: true },
        { name: 'Strikes',   value: `${strikes}`,           inline: true },
        { name: 'Expires',   value: entry.expiresAt ? formatExpiry(entry.expiresAt) : 'Never', inline: true },
        { name: 'Reason',    value: entry.reason,            inline: false },
      );
  }

  await interaction.editReply({ embeds: [embed] });
}

// ── /blacklist stats ──────────────────────────────────
async function handleStats(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });

  const stats = db.blacklist.stats(interaction.guild.id);

  const catLines = stats.byCategory.map(c => `\`${c.category}\` — ${c.c}`).join('\n') || 'None';

  const embed = new EmbedBuilder()
    .setColor(0x5e80eb)
    .setTitle('📊 Blacklist Stats')
    .addFields(
      { name: 'Total BLs',    value: `${stats.total}`,     inline: true },
      { name: 'Permanent',    value: `${stats.permanent}`, inline: true },
      { name: 'Temporary',    value: `${stats.temp}`,      inline: true },
      { name: 'Appeals',      value: `✅ ${stats.appealStats.accepted} accepted\n❌ ${stats.appealStats.denied} denied\n⏳ ${stats.appealStats.pending} pending`, inline: true },
      { name: 'By Category',  value: catLines,             inline: false },
    )
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ── /blacklist list ───────────────────────────────────
async function handleList(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });

  const entries = db.blacklist.list(interaction.guild.id);
  if (!entries.length) return interaction.editReply({ content: '✅ No blacklisted members.' });

  const totalPages = Math.ceil(entries.length / PAGE_SIZE);
  let page = 0;

  const msg = await interaction.editReply({
    embeds: [buildListEmbed(entries, page, totalPages, interaction.guild)],
    components: totalPages > 1 ? [buildPaginationRow(page, totalPages)] : [],
  });

  if (totalPages <= 1) return;
  const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) return i.reply({ content: '❌ Not your list.', ephemeral: true });
    page = i.customId === 'next' ? page + 1 : page - 1;
    await i.update({ embeds: [buildListEmbed(entries, page, totalPages, interaction.guild)], components: [buildPaginationRow(page, totalPages)] });
  });
  collector.on('end', () => interaction.editReply({ components: [] }).catch(() => null));
}

// ── /blacklist search ─────────────────────────────────
async function handleSearch(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });

  const keyword = interaction.options.getString('keyword');
  const entries = db.blacklist.search(interaction.guild.id, keyword);
  if (!entries.length) return interaction.editReply({ content: `❌ No results for \`${keyword}\`.` });

  const totalPages = Math.ceil(entries.length / PAGE_SIZE);
  let page = 0;
  const title = `🔍 Search: "${keyword}" — ${entries.length} result(s)`;

  const msg = await interaction.editReply({
    embeds: [buildListEmbed(entries, page, totalPages, interaction.guild, title)],
    components: totalPages > 1 ? [buildPaginationRow(page, totalPages)] : [],
  });

  if (totalPages <= 1) return;
  const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) return i.reply({ content: '❌ Not your search.', ephemeral: true });
    page = i.customId === 'next' ? page + 1 : page - 1;
    await i.update({ embeds: [buildListEmbed(entries, page, totalPages, interaction.guild, title)], components: [buildPaginationRow(page, totalPages)] });
  });
  collector.on('end', () => interaction.editReply({ components: [] }).catch(() => null));
}

// ── /blacklist edit ───────────────────────────────────
async function handleEdit(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });

  const target   = interaction.options.getUser('user');
  const reason   = interaction.options.getString('reason');
  const category = interaction.options.getString('category');

  if (!reason && !category) return interaction.editReply({ content: '❌ You must provide at least a new reason or category.' });
  if (category && !db.categories.exists({ guildId: interaction.guild.id, name: category })) {
    return interaction.editReply({ content: `❌ Category \`${category}\` doesn't exist.` });
  }

  const entry = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });
  if (!entry) return interaction.editReply({ content: `❌ No blacklist found for <@${target.id}>.` });

  db.blacklist.update({ userId: target.id, guildId: interaction.guild.id, reason, category, moderatorId: interaction.user.id });
  const updated = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });

  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('✏️ Blacklist Updated')
    .addFields(
      { name: 'Case ID',   value: `\`${entry.caseId}\``,       inline: true },
      { name: 'User',      value: `<@${target.id}>`,           inline: true },
      { name: 'Edited By', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Reason',    value: updated.reason,               inline: false },
      { name: 'Category',  value: updated.category,             inline: true },
    )
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.guild, embed);
}

// ── /blacklist export ─────────────────────────────────
async function handleExport(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });

  const format  = interaction.options.getString('format');
  const entries = db.blacklist.list(interaction.guild.id);
  if (!entries.length) return interaction.editReply({ content: '✅ No entries to export.' });

  let content, filename;

  if (format === 'csv') {
    const rows = entries.map(e =>
      `"${e.caseId}","${e.userId}","${e.category}","${e.reason.replace(/"/g, '""')}","${e.acceptedBy}","${e.createdAt.toISOString()}","${e.expiresAt?.toISOString() ?? ''}"`
    );
    content  = `"Case ID","User ID","Category","Reason","Accepted By","Created At","Expires At"\n${rows.join('\n')}`;
    filename = `blacklist-${interaction.guild.id}-${Date.now()}.csv`;
  } else {
    content  = `BLACKLIST EXPORT — ${interaction.guild.name}\nGenerated: ${new Date().toISOString()}\nTotal: ${entries.length}\n\n` +
      entries.map((e, i) => `${i+1}. [${e.caseId}] UserID: ${e.userId} | Category: ${e.category} | Reason: ${e.reason} | By: ${e.acceptedBy} | Date: ${e.createdAt.toISOString()}${e.expiresAt ? ` | Expires: ${e.expiresAt.toISOString()}` : ''}`).join('\n');
    filename = `blacklist-${interaction.guild.id}-${Date.now()}.txt`;
  }

  await interaction.editReply({
    content: `📄 Exported **${entries.length}** entries as \`${format.toUpperCase()}\`.`,
    files: [{ attachment: Buffer.from(content, 'utf-8'), name: filename }],
  });
}

// ── /blacklist appeal ─────────────────────────────────
async function handleAppealSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const reason = interaction.options.getString('reason');
  const entry  = db.blacklist.findOne({ userId: interaction.user.id, guildId: interaction.guild.id });
  if (!entry) return interaction.editReply({ content: '✅ You are not blacklisted in this server.' });

  const pending = db.appeals.findPending({ userId: interaction.user.id, guildId: interaction.guild.id });
  if (pending) return interaction.editReply({ content: '❌ You already have a pending appeal.' });

  const lastDenied = db.appeals.findLastDenied({ userId: interaction.user.id, guildId: interaction.guild.id });
  if (lastDenied) {
    const cooldownEnd = new Date(new Date(lastDenied.deniedAt).getTime() + APPEAL_COOLDOWN_DAYS * 86400000);
    if (cooldownEnd > new Date()) {
      return interaction.editReply({ content: `❌ You can appeal again <t:${Math.floor(cooldownEnd.getTime()/1000)}:R>.` });
    }
  }

  const appealId = db.appeals.create({ userId: interaction.user.id, guildId: interaction.guild.id, reason });

  const embed = new EmbedBuilder()
    .setColor(0x5e80eb)
    .setTitle('📩 New Blacklist Appeal')
    .addFields(
      { name: 'User',          value: `<@${interaction.user.id}>\n\`${interaction.user.id}\``, inline: true },
      { name: 'Appeal ID',     value: `\`#${appealId}\``,                                      inline: true },
      { name: 'Case ID',       value: `\`${entry.caseId}\``,                                   inline: true },
      { name: 'Appeal Reason', value: reason,                                                   inline: false },
      { name: 'BL Reason',     value: entry.reason,                                             inline: false },
      { name: 'BL Category',   value: entry.category,                                           inline: true },
    )
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `Use /blacklist appeal-accept or appeal-deny with id:${appealId}` })
    .setTimestamp();

  await sendLog(interaction.guild, embed);
  await interaction.editReply({ content: `✅ Appeal submitted (ID: \`#${appealId}\`). Staff will review it soon.` });
}

// ── /blacklist appeal-accept ──────────────────────────
async function handleAppealAccept(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  await interaction.deferReply();

  const appealId = interaction.options.getInteger('id');
  const reason   = interaction.options.getString('reason');
  const appeal   = db.appeals.findById(appealId);

  if (!appeal || appeal.guildId !== interaction.guild.id) return interaction.editReply({ content: `❌ Appeal \`#${appealId}\` not found.` });
  if (appeal.status !== 'pending') return interaction.editReply({ content: `❌ This appeal is already **${appeal.status}**.` });

  const entry  = db.blacklist.findOne({ userId: appeal.userId, guildId: interaction.guild.id });
  const target = await interaction.client.users.fetch(appeal.userId).catch(() => null);

  if (entry) await removeBlacklist(interaction.guild, appeal.userId, entry, { moderatorId: interaction.user.id, reason: `Appeal accepted: ${reason}` });
  db.appeals.updateStatus(appealId, 'accepted', { decidedBy: interaction.user.id, decisionReason: reason });

  if (target) await target.send(`✅ Your blacklist appeal in **${interaction.guild.name}** was **accepted**.\n**Reason:** ${reason}`).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(0x3ba55c)
    .setTitle('✅ Appeal Accepted')
    .addFields(
      { name: 'User',        value: target ? `<@${target.id}>` : `\`${appeal.userId}\``, inline: true },
      { name: 'Appeal ID',   value: `\`#${appealId}\``,                                  inline: true },
      { name: 'Accepted By', value: `<@${interaction.user.id}>`,                         inline: true },
      { name: 'Reason',      value: reason,                                               inline: false },
    )
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.guild, embed);
}

// ── /blacklist appeal-deny ────────────────────────────
async function handleAppealDeny(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  await interaction.deferReply();

  const appealId = interaction.options.getInteger('id');
  const reason   = interaction.options.getString('reason');
  const appeal   = db.appeals.findById(appealId);

  if (!appeal || appeal.guildId !== interaction.guild.id) return interaction.editReply({ content: `❌ Appeal \`#${appealId}\` not found.` });
  if (appeal.status !== 'pending') return interaction.editReply({ content: `❌ This appeal is already **${appeal.status}**.` });

  db.appeals.updateStatus(appealId, 'denied', { decidedBy: interaction.user.id, decisionReason: reason });

  const target = await interaction.client.users.fetch(appeal.userId).catch(() => null);
  if (target) await target.send(`❌ Your blacklist appeal in **${interaction.guild.name}** was **denied**.\n**Reason:** ${reason}\nYou may appeal again in **${APPEAL_COOLDOWN_DAYS} days**.`).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(0xe84142)
    .setTitle('❌ Appeal Denied')
    .addFields(
      { name: 'User',      value: target ? `<@${target.id}>` : `\`${appeal.userId}\``, inline: true },
      { name: 'Appeal ID', value: `\`#${appealId}\``,                                  inline: true },
      { name: 'Denied By', value: `<@${interaction.user.id}>`,                         inline: true },
      { name: 'Reason',    value: reason,                                               inline: false },
    )
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.guild, embed);
}

// ── /blacklist category-add ───────────────────────────
async function handleCategoryAdd(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  const name  = interaction.options.getString('name').trim();
  const color = interaction.options.getString('color') ?? '#e84142';

  if (!name) return interaction.reply({ content: '❌ Category name cannot be empty.', ephemeral: true });
  if (name.length > 32) return interaction.reply({ content: '❌ Category name must be 32 characters or fewer.', ephemeral: true });
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return interaction.reply({ content: '❌ Invalid hex color. Use format `#ff0000`.', ephemeral: true });
  if (db.categories.exists({ guildId: interaction.guild.id, name })) {
    return interaction.reply({ content: `❌ Category \`${name}\` already exists.`, ephemeral: true });
  }

  db.categories.add({ guildId: interaction.guild.id, name, color });
  await interaction.reply({ content: `✅ Category \`${name}\` created.`, ephemeral: true });
}

// ── /blacklist category-remove ────────────────────────
async function handleCategoryRemove(interaction) {
  if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  const name = interaction.options.getString('name');
  if (!db.categories.exists({ guildId: interaction.guild.id, name })) {
    return interaction.reply({ content: `❌ Category \`${name}\` not found.`, ephemeral: true });
  }
  if (db.categories.isDefault(name)) {
    return interaction.reply({ content: `❌ Cannot remove default category \`${name}\`.`, ephemeral: true });
  }
  db.categories.remove({ guildId: interaction.guild.id, name });
  await interaction.reply({ content: `✅ Category \`${name}\` removed.`, ephemeral: true });
}

// ── /blacklist category-list ──────────────────────────
async function handleCategoryList(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const cats = db.categories.list(interaction.guild.id);

  const lines = cats.map(c => `${c.isDefault ? '🌐' : '✨'} **${c.name}** ${c.color}`).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5e80eb)
    .setTitle('📂 Categories')
    .setDescription(lines || 'No categories')
    .setFooter({ text: '🌐 = Default  ✨ = Custom' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ── /blacklist setlogchannel ──────────────────────────
async function handleSetLogChannel(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  const channel = interaction.options.getChannel('channel');
  if (!channel.isTextBased()) return interaction.reply({ content: '❌ Please select a text channel.', ephemeral: true });
  db.settings.setLogChannel(interaction.guild.id, channel.id);
  await interaction.reply({ content: `✅ Log channel set to <#${channel.id}>`, ephemeral: true });
}

// ── /blacklist setstaffrole ───────────────────────────
async function handleSetStaffRole(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  const role = interaction.options.getRole('role');
  db.settings.setStaffRole(interaction.guild.id, role.id);
  await interaction.reply({ content: `✅ Staff role set to <@&${role.id}>`, ephemeral: true });
}

// ── Main router ───────────────────────────────────────
const blacklistCmd = {
  data,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'add':             return handleAdd(interaction);
      case 'remove':          return handleRemove(interaction);
      case 'info':            return handleInfo(interaction);
      case 'history':         return handleHistory(interaction);
      case 'check':           return handleCheck(interaction);
      case 'stats':           return handleStats(interaction);
      case 'list':            return handleList(interaction);
      case 'search':          return handleSearch(interaction);
      case 'edit':            return handleEdit(interaction);
      case 'export':          return handleExport(interaction);
      case 'appeal':          return handleAppealSubmit(interaction);
      case 'appeal-accept':   return handleAppealAccept(interaction);
      case 'appeal-deny':     return handleAppealDeny(interaction);
      case 'category-add':    return handleCategoryAdd(interaction);
      case 'category-remove': return handleCategoryRemove(interaction);
      case 'category-list':   return handleCategoryList(interaction);
      case 'setlogchannel':   return handleSetLogChannel(interaction);
      case 'setstaffrole':    return handleSetStaffRole(interaction);
    }
  },
};

module.exports = { blacklistCmd, data };
