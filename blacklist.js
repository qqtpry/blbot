const {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType
} = require('discord.js');
const db = require('../database');

const CATEGORY_LABELS = {
  appealable:     '⚖️  Appealable',
  non_appealable: '🔒  Non-Appealable',
  temporary:      '⏳  Temporary',
};

const APPEAL_COOLDOWN_DAYS = 7;
const PAGE_SIZE = 10;

// ── Permission check ────────────────────────────────
async function hasPermission(interaction) {
  // Always allow Manage Guild (admins/owner)
  if (interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return true;

  // Allow custom staff role if set
  const staffRoleId = db.settings.getStaffRole(interaction.guild.id);
  if (staffRoleId && interaction.member.roles.cache.has(staffRoleId)) return true;

  // Allow if member has any role higher than the bot's highest role
  const botMember   = await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember) return false;
  const botTopRole  = botMember.roles.highest;
  const memberTop   = interaction.member.roles.highest;
  if (memberTop.comparePositionTo(botTopRole) > 0) return true;

  return false;
}

// ── Get or create [BLACKLISTED] role ────────────────
async function getOrCreateBlacklistRole(guild) {
  let role = guild.roles.cache.find(r => r.name === '[BLACKLISTED]');
  if (!role) {
    role = await guild.roles.create({
      name: '[BLACKLISTED]',
      colors: [0x2b2d31],
      permissions: [],
      reason: 'Auto-created by BLBot',
    });
    for (const [, channel] of guild.channels.cache) {
      if (!channel.permissionOverwrites) continue;
      await channel.permissionOverwrites.create(role, {
        SendMessages: false, AddReactions: false,
        Speak: false, SendMessagesInThreads: false,
      }).catch(() => null);
    }
  }
  return role;
}

// ── Send to log channel ──────────────────────────────
async function sendLog(guild, embed) {
  const channelId = db.settings.getLogChannel(guild.id);
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (channel) await channel.send({ embeds: [embed] }).catch(() => null);
}

// ── Remove BL from a member ──────────────────────────
async function removeBlacklist(guild, userId, entry) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) {
    const blRole     = guild.roles.cache.find(r => r.name === '[BLACKLISTED]');
    const validRoles = entry.roles.filter(id => guild.roles.cache.has(id) && id !== blRole?.id);
    await member.roles.set(validRoles).catch(() => null);
    await member.setNickname(entry.nickname ?? null).catch(() => null);
  }
  db.blacklist.delete({ userId, guildId: guild.id });
  return member;
}

// ── Paginated embed helper ───────────────────────────
function buildListEmbed(entries, page, totalPages, guild) {
  const slice = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const lines = slice.map((e, i) => {
    const num     = page * PAGE_SIZE + i + 1;
    const expiry  = e.expiresAt ? ` · expires <t:${Math.floor(e.expiresAt.getTime()/1000)}:R>` : '';
    return `\`${num}.\` <@${e.userId}> — ${CATEGORY_LABELS[e.category] ?? e.category}${expiry}\n> ${e.reason}`;
  }).join('\n\n');

  return new EmbedBuilder()
    .setColor(0xe84142)
    .setTitle(`🔨  Blacklisted Members — ${entries.length} total`)
    .setDescription(lines || '*No entries*')
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${guild.name}`, iconURL: guild.iconURL() })
    .setTimestamp();
}

// ── Command definition ───────────────────────────────
// ── Command definition ───────────────────────────────
const data = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Blacklist management')

  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Blacklist a member')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    .addStringOption(o => o.setName('category').setDescription('BL category').setRequired(true)
      .addChoices(
        { name: '⚖️  Appealable',     value: 'appealable' },
        { name: '🔒  Non-Appealable', value: 'non_appealable' },
        { name: '⏳  Temporary',      value: 'temporary' },
      ))
    .addUserOption(o => o.setName('requested_by').setDescription('Who requested this?'))
    .addStringOption(o => o.setName('duration').setDescription('Duration e.g. 1d, 12h, 30m')))

  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Remove a blacklist and restore roles')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for removal').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('info')
    .setDescription('Look up a blacklist entry')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)))

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
    .addStringOption(o => o.setName('category').setDescription('New category')
      .addChoices(
        { name: '⚖️  Appealable',     value: 'appealable' },
        { name: '🔒  Non-Appealable', value: 'non_appealable' },
        { name: '⏳  Temporary',      value: 'temporary' },
      )))

  .addSubcommand(sub => sub
    .setName('export')
    .setDescription('Export the full blacklist as a text file'))

  .addSubcommand(sub => sub
    .setName('appeal')
    .setDescription('Submit an appeal for your blacklist')
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
    .setName('setlogchannel')
    .setDescription('Set the channel for blacklist logs')
    .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('setstaffrole')
    .setDescription('Set a staff role that can use blacklist commands')
    .addRoleOption(o => o.setName('role').setDescription('Staff role').setRequired(true)));

// ── Parse duration string ────────────────────────────
function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(d|h|m)$/);
  if (!match) return null;
  const num  = parseInt(match[1]);
  const unit = match[2];
  const ms   = unit === 'd' ? num * 86400000 : unit === 'h' ? num * 3600000 : num * 60000;
  return new Date(Date.now() + ms);
}

// ── /blacklist add ───────────────────────────────────
async function handleAdd(interaction) {
  if (!await hasPermission(interaction)) {
    return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
  }

  const target   = interaction.options.getUser('user');
  const reason   = interaction.options.getString('reason');
  const category = interaction.options.getString('category');
  const reqBy    = interaction.options.getUser('requested_by');
  const duration = interaction.options.getString('duration');
  const expiresAt = parseDuration(duration);

  if (duration && !expiresAt) {
    return interaction.reply({ content: '❌ Invalid duration format. Use `1d`, `12h`, or `30m`.', ephemeral: true });
  }

  const existing = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });
  if (existing) {
    return interaction.reply({ content: `❌ <@${target.id}> is already blacklisted.`, ephemeral: true });
  }

  const confirmEmbed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('⚠️  Confirm Blacklist')
    .setDescription(`Are you sure you want to blacklist <@${target.id}>?`)
    .addFields(
      { name: 'Reason',   value: reason,                    inline: true },
      { name: 'Category', value: CATEGORY_LABELS[category], inline: true },
      { name: 'Duration', value: expiresAt ? `Expires <t:${Math.floor(expiresAt.getTime()/1000)}:R>` : 'Permanent', inline: true },
    )
    .setThumbnail(target.displayAvatarURL({ dynamic: true }));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bl_confirm').setLabel('Confirm').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('bl_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  const confirmMsg = await interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true, fetchReply: true });

  const collector = confirmMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: i => i.user.id === interaction.user.id && ['bl_confirm', 'bl_cancel'].includes(i.customId),
    time: 30_000, max: 1,
  });

  collector.on('collect', async i => {
    if (i.customId === 'bl_cancel') {
      return i.update({ content: '❌ Blacklist cancelled.', embeds: [], components: [] });
    }

    await i.update({ content: '⏳ Processing...', embeds: [], components: [] });

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return i.editReply({ content: `❌ Could not find that member in this server.` });

    const roles    = member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.id);
    const nickname = member.nickname ?? null;
    const blCount  = db.blacklist.count(interaction.guild.id) + 1;

    db.blacklist.create({
      userId: target.id, guildId: interaction.guild.id,
      reason, category, requestedBy: reqBy?.id,
      acceptedBy: interaction.user.id, roles, nickname, expiresAt,
    });

    const blRole = await getOrCreateBlacklistRole(interaction.guild);
    await member.roles.set([blRole]).catch(() => null);
    await member.setNickname(`[BLACKLISTED] ${member.user.username}`).catch(() => null);

    let dmStatus = '❌ Could not send';
    try {
      await target.send(`🔨 You have been blacklisted in **${interaction.guild.name}**.\n**Reason:** ${reason}\n**Category:** ${CATEGORY_LABELS[category]}${expiresAt ? `\n**Expires:** <t:${Math.floor(expiresAt.getTime()/1000)}:F>` : ''}`);
      dmStatus = '✉️  Sent';
    } catch (_) {}

    const embed = new EmbedBuilder()
      .setColor(0xe84142)
      .setTitle('🔨  Member Blacklisted')
      .setDescription(`<@${target.id}> has been blacklisted`)
      .addFields(
        { name: 'User',           value: `<@${target.id}>\n\`${target.id}\``,              inline: true },
        { name: 'Category',       value: CATEGORY_LABELS[category],                         inline: true },
        { name: 'DM Status',      value: dmStatus,                                          inline: true },
        { name: 'Requested By',   value: reqBy ? `<@${reqBy.id}>` : '*N/A*',               inline: true },
        { name: 'Accepted By',    value: `<@${interaction.user.id}>`,                      inline: true },
        { name: 'Duration',       value: expiresAt ? `Expires <t:${Math.floor(expiresAt.getTime()/1000)}:R>` : 'Permanent', inline: true },
        { name: 'Reason',         value: reason,                                            inline: false },
        { name: 'Roles Stripped', value: `${roles.length} role(s) stored`,                 inline: true },
        { name: 'Nickname',       value: `\`[BLACKLISTED] ${member.user.username}\``,      inline: true },
      )
      .setThumbnail(target.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: `${interaction.guild.name} • Total BLs: ${blCount}`, iconURL: interaction.guild.iconURL() })
      .setTimestamp();

    await i.editReply({ content: '✅ Blacklist applied.', embeds: [], components: [] });
    await interaction.channel.send({ embeds: [embed] });
    await sendLog(interaction.guild, embed);
  });

  collector.on('end', collected => {
    if (!collected.size) interaction.editReply({ content: '⏰ Timed out.', embeds: [], components: [] }).catch(() => null);
  });
}

// ── /blacklist remove ────────────────────────────────
async function handleRemove(interaction) {
  if (!await hasPermission(interaction)) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  await interaction.deferReply();

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const entry  = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });
  if (!entry) return interaction.editReply({ content: `❌ No blacklist entry found for <@${target.id}>.` });

  const member       = await removeBlacklist(interaction.guild, target.id, entry);
  const restoredCount = entry.roles.filter(id => interaction.guild.roles.cache.has(id)).length;
  const blCount       = db.blacklist.count(interaction.guild.id);

  let dmStatus = '❌ Could not send';
  try {
    await target.send(`✅ Your blacklist in **${interaction.guild.name}** has been lifted.\n**Reason:** ${reason}`);
    dmStatus = '✉️  Sent';
  } catch (_) {}

  const embed = new EmbedBuilder()
    .setColor(0x3ba55c)
    .setTitle('✅  Member Unblacklisted')
    .setDescription(`<@${target.id}> has been unblacklisted and roles restored`)
    .addFields(
      { name: 'User',              value: `<@${target.id}>\n\`${target.id}\``,               inline: true },
      { name: 'Responsible Mod',   value: `<@${interaction.user.id}>`,                       inline: true },
      { name: 'DM Status',         value: dmStatus,                                           inline: true },
      { name: 'Reason',            value: reason,                                             inline: false },
      { name: 'Roles Restored',    value: `${restoredCount} role(s)`,                        inline: true },
      { name: 'Nickname',          value: entry.nickname ? `Restored to: \`${entry.nickname}\`` : '*Cleared*', inline: true },
      { name: '\u200B',            value: '\u200B',                                           inline: true },
      { name: 'Original Reason',   value: entry.reason,                                       inline: false },
      { name: 'Original Category', value: CATEGORY_LABELS[entry.category] ?? entry.category, inline: true },
    )
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `${interaction.guild.name} • Total BLs: ${blCount}`, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.guild, embed);
}

// ── /blacklist info ──────────────────────────────────
async function handleInfo(interaction) {
  if (!await hasPermission(interaction)) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser('user');
  const entry  = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });
  if (!entry) return interaction.editReply({ content: `✅ <@${target.id}> is **not** blacklisted.` });

  const strikes = db.strikes.count({ userId: target.id, guildId: interaction.guild.id });

  const embed = new EmbedBuilder()
    .setColor(0x5e80eb)
    .setTitle('📋  Blacklist Info')
    .setDescription(`Active blacklist entry for <@${target.id}>`)
    .addFields(
      { name: 'User',           value: `<@${target.id}>\n\`${target.id}\``,              inline: true },
      { name: 'Status',         value: '🔴 Blacklisted',                                  inline: true },
      { name: 'Strikes',        value: `${strikes}`,                                      inline: true },
      { name: 'Reason',         value: entry.reason,                                       inline: false },
      { name: 'Category',       value: CATEGORY_LABELS[entry.category] ?? entry.category, inline: true },
      { name: 'Accepted By',    value: `<@${entry.acceptedBy}>`,                          inline: true },
      { name: 'Requested By',   value: entry.requestedBy ? `<@${entry.requestedBy}>` : '*N/A*', inline: true },
      { name: 'Roles Stored',   value: `${entry.roles.length} role(s)`,                   inline: true },
      { name: 'Expires',        value: entry.expiresAt ? `<t:${Math.floor(entry.expiresAt.getTime()/1000)}:R>` : 'Never', inline: true },
      { name: 'Blacklisted On', value: `<t:${Math.floor(entry.createdAt.getTime()/1000)}:F>`, inline: false },
    )
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ── /blacklist list (paginated) ──────────────────────
async function handleList(interaction) {
  if (!await hasPermission(interaction)) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const entries = db.blacklist.list(interaction.guild.id);
  if (!entries.length) return interaction.editReply({ content: '✅ No blacklisted members in this server.' });

  const totalPages = Math.ceil(entries.length / PAGE_SIZE);
  let page = 0;

  const buildRow = (p) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
    new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1),
  );

  const msg = await interaction.editReply({ embeds: [buildListEmbed(entries, page, totalPages, interaction.guild)], components: totalPages > 1 ? [buildRow(page)] : [] });

  if (totalPages <= 1) return;

  const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) return i.reply({ content: '❌ Not your list.', ephemeral: true });
    page = i.customId === 'next' ? page + 1 : page - 1;
    await i.update({ embeds: [buildListEmbed(entries, page, totalPages, interaction.guild)], components: [buildRow(page)] });
  });
  collector.on('end', () => interaction.editReply({ components: [] }).catch(() => null));
}

// ── /blacklist search ────────────────────────────────
async function handleSearch(interaction) {
  if (!await hasPermission(interaction)) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const keyword = interaction.options.getString('keyword');
  const entries = db.blacklist.search(interaction.guild.id, keyword);

  if (!entries.length) return interaction.editReply({ content: `❌ No results for \`${keyword}\`.` });

  const totalPages = Math.ceil(entries.length / PAGE_SIZE);
  let page = 0;

  const buildRow = (p) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
    new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1),
  );

  const embed = buildListEmbed(entries, page, totalPages, interaction.guild);
  embed.setTitle(`🔍  Search: "${keyword}" — ${entries.length} result(s)`);

  const msg = await interaction.editReply({ embeds: [embed], components: totalPages > 1 ? [buildRow(page)] : [] });

  if (totalPages <= 1) return;

  const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) return i.reply({ content: '❌ Not your search.', ephemeral: true });
    page = i.customId === 'next' ? page + 1 : page - 1;
    const e = buildListEmbed(entries, page, totalPages, interaction.guild);
    e.setTitle(`🔍  Search: "${keyword}" — ${entries.length} result(s)`);
    await i.update({ embeds: [e], components: [buildRow(page)] });
  });
  collector.on('end', () => interaction.editReply({ components: [] }).catch(() => null));
}

// ── /blacklist edit ──────────────────────────────────
async function handleEdit(interaction) {
  if (!await hasPermission(interaction)) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const target   = interaction.options.getUser('user');
  const reason   = interaction.options.getString('reason');
  const category = interaction.options.getString('category');

  const entry = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });
  if (!entry) return interaction.editReply({ content: `❌ No blacklist entry found for <@${target.id}>.` });

  db.blacklist.update({ userId: target.id, guildId: interaction.guild.id, reason, category });
  const updated = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });

  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('✏️  Blacklist Updated')
    .addFields(
      { name: 'User',      value: `<@${target.id}>`,                                        inline: true },
      { name: 'Edited By', value: `<@${interaction.user.id}>`,                              inline: true },
      { name: '\u200B',    value: '\u200B',                                                  inline: true },
      { name: 'Reason',    value: updated.reason,                                            inline: false },
      { name: 'Category',  value: CATEGORY_LABELS[updated.category] ?? updated.category,    inline: true },
    )
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.guild, embed);
}

// ── /blacklist export ────────────────────────────────
async function handleExport(interaction) {
  if (!await hasPermission(interaction)) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const entries = db.blacklist.list(interaction.guild.id);
  if (!entries.length) return interaction.editReply({ content: '✅ No blacklisted members to export.' });

  const lines = entries.map((e, i) =>
    `${i + 1}. UserID: ${e.userId} | Category: ${e.category} | Reason: ${e.reason} | BL'd by: ${e.acceptedBy} | Date: ${e.createdAt.toISOString()}${e.expiresAt ? ` | Expires: ${e.expiresAt.toISOString()}` : ''}`
  ).join('\n');

  const buffer = Buffer.from(`BLACKLIST EXPORT - ${interaction.guild.name}\nGenerated: ${new Date().toISOString()}\nTotal: ${entries.length}\n\n${lines}`, 'utf-8');

  await interaction.editReply({
    content: `📄 Exported **${entries.length}** entries.`,
    files: [{ attachment: buffer, name: `blacklist-export-${Date.now()}.txt` }],
  });
}

// ── /blacklist appeal (submit) ───────────────────────
async function handleAppealSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const reason = interaction.options.getString('reason');
  const entry  = db.blacklist.findOne({ userId: interaction.user.id, guildId: interaction.guild.id });
  if (!entry) return interaction.editReply({ content: `✅ You are not blacklisted in this server.` });

  if (entry.category === 'non_appealable') {
    return interaction.editReply({ content: `❌ Your blacklist is **Non-Appealable** and cannot be appealed.` });
  }

  const pending = db.appeals.findPending({ userId: interaction.user.id, guildId: interaction.guild.id });
  if (pending) return interaction.editReply({ content: `❌ You already have a pending appeal. Wait for staff to review it.` });

  // Cooldown check
  const lastDenied = db.appeals.findLastDenied({ userId: interaction.user.id, guildId: interaction.guild.id });
  if (lastDenied) {
    const cooldownEnd = new Date(new Date(lastDenied.deniedAt).getTime() + APPEAL_COOLDOWN_DAYS * 86400000);
    if (cooldownEnd > new Date()) {
      return interaction.editReply({ content: `❌ Your last appeal was denied. You can appeal again <t:${Math.floor(cooldownEnd.getTime()/1000)}:R>.` });
    }
  }

  const appealId = db.appeals.create({ userId: interaction.user.id, guildId: interaction.guild.id, reason });

  const embed = new EmbedBuilder()
    .setColor(0x5e80eb)
    .setTitle('📩  New Blacklist Appeal')
    .addFields(
      { name: 'User',          value: `<@${interaction.user.id}>\n\`${interaction.user.id}\``, inline: true },
      { name: 'Appeal ID',     value: `\`#${appealId}\``,                                      inline: true },
      { name: '\u200B',        value: '\u200B',                                                 inline: true },
      { name: 'Appeal Reason', value: reason,                                                   inline: false },
      { name: 'BL Reason',     value: entry.reason,                                             inline: false },
      { name: 'BL Category',   value: CATEGORY_LABELS[entry.category] ?? entry.category,       inline: true },
    )
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `Use /blacklist appeal accept/deny id:${appealId} to respond` })
    .setTimestamp();

  await sendLog(interaction.guild, embed);
  await interaction.editReply({ content: `✅ Appeal submitted (ID: \`#${appealId}\`). Staff will review it soon. Note: if denied, you must wait **${APPEAL_COOLDOWN_DAYS} days** before appealing again.` });
}

// ── /blacklist appeal accept ─────────────────────────
async function handleAppealAccept(interaction) {
  if (!await hasPermission(interaction)) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  await interaction.deferReply();

  const appealId = interaction.options.getInteger('id');
  const reason   = interaction.options.getString('reason');
  const appeal   = db.appeals.findById(appealId);

  if (!appeal || appeal.guildId !== interaction.guild.id) return interaction.editReply({ content: `❌ Appeal \`#${appealId}\` not found.` });
  if (appeal.status !== 'pending') return interaction.editReply({ content: `❌ This appeal is already **${appeal.status}**.` });

  const entry  = db.blacklist.findOne({ userId: appeal.userId, guildId: interaction.guild.id });
  const target = await interaction.client.users.fetch(appeal.userId).catch(() => null);

  if (entry) await removeBlacklist(interaction.guild, appeal.userId, entry);
  db.appeals.updateStatus(appealId, 'accepted');

  if (target) await target.send(`✅ Your blacklist appeal in **${interaction.guild.name}** has been **accepted**.\n**Reason:** ${reason}`).catch(() => null);

  const blCount = db.blacklist.count(interaction.guild.id);

  const embed = new EmbedBuilder()
    .setColor(0x3ba55c)
    .setTitle('✅  Appeal Accepted')
    .addFields(
      { name: 'User',        value: target ? `<@${target.id}>` : `\`${appeal.userId}\``, inline: true },
      { name: 'Appeal ID',   value: `\`#${appealId}\``,                                  inline: true },
      { name: 'Accepted By', value: `<@${interaction.user.id}>`,                         inline: true },
      { name: 'Reason',      value: reason,                                               inline: false },
    )
    .setFooter({ text: `${interaction.guild.name} • Total BLs: ${blCount}`, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.guild, embed);
}

// ── /blacklist appeal deny ───────────────────────────
async function handleAppealDeny(interaction) {
  if (!await hasPermission(interaction)) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  await interaction.deferReply();

  const appealId = interaction.options.getInteger('id');
  const reason   = interaction.options.getString('reason');
  const appeal   = db.appeals.findById(appealId);

  if (!appeal || appeal.guildId !== interaction.guild.id) return interaction.editReply({ content: `❌ Appeal \`#${appealId}\` not found.` });
  if (appeal.status !== 'pending') return interaction.editReply({ content: `❌ This appeal is already **${appeal.status}**.` });

  db.appeals.updateStatus(appealId, 'denied');

  const target = await interaction.client.users.fetch(appeal.userId).catch(() => null);
  if (target) await target.send(`❌ Your blacklist appeal in **${interaction.guild.name}** has been **denied**.\n**Reason:** ${reason}\nYou may appeal again in **${APPEAL_COOLDOWN_DAYS} days**.`).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(0xe84142)
    .setTitle('❌  Appeal Denied')
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

// ── /blacklist setlogchannel ─────────────────────────
async function handleSetLogChannel(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Only Manage Guild can set the log channel.', ephemeral: true });
  }
  const channel = interaction.options.getChannel('channel');
  db.settings.setLogChannel(interaction.guild.id, channel.id);
  await interaction.reply({ content: `✅ Log channel set to <#${channel.id}>`, ephemeral: true });
}

// ── /blacklist setstaffrole ──────────────────────────
async function handleSetStaffRole(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Only Manage Guild can set the staff role.', ephemeral: true });
  }
  const role = interaction.options.getRole('role');
  db.settings.setStaffRole(interaction.guild.id, role.id);
  await interaction.reply({ content: `✅ Staff role set to <@&${role.id}>`, ephemeral: true });
}

// ── Main router ──────────────────────────────────────
const blacklistCmd = {
  data,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'add':            return handleAdd(interaction);
      case 'remove':         return handleRemove(interaction);
      case 'info':           return handleInfo(interaction);
      case 'list':           return handleList(interaction);
      case 'search':         return handleSearch(interaction);
      case 'edit':           return handleEdit(interaction);
      case 'export':         return handleExport(interaction);
      case 'appeal':         return handleAppealSubmit(interaction);
      case 'appeal-accept':  return handleAppealAccept(interaction);
      case 'appeal-deny':    return handleAppealDeny(interaction);
      case 'setlogchannel':  return handleSetLogChannel(interaction);
      case 'setstaffrole':   return handleSetStaffRole(interaction);
    }
  },
};

module.exports = { blacklistCmd, data };