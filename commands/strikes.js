const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

const data = new SlashCommandBuilder()
  .setName('strike')
  .setDescription('Strike management')

  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Add a strike to a member')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Remove a strike by ID')
    .addIntegerOption(o => o.setName('id').setDescription('Strike ID').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('View all strikes for a member')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('threshold')
    .setDescription('Set auto-blacklist strike threshold (0 = disabled)')
    .addIntegerOption(o => o.setName('count').setDescription('Number of strikes before auto-blacklist').setRequired(true)));

async function hasPermission(interaction) {
  if (interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const staffRoleId = db.settings.getStaffRole(interaction.guild.id);
  if (staffRoleId && interaction.member.roles.cache.has(staffRoleId)) return true;
  const botMember = await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember) return false;
  if (interaction.member.roles.highest.comparePositionTo(botMember.roles.highest) > 0) return true;
  return false;
}

const strikeCmd = {
  data,
  async execute(interaction) {
    if (!await hasPermission(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      await interaction.deferReply();
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      if (target.id === interaction.user.id) return interaction.editReply({ content: '❌ You cannot strike yourself.' });
      if (target.bot) return interaction.editReply({ content: '❌ You cannot strike a bot.' });

      db.strikes.add({ userId: target.id, guildId: interaction.guild.id, reason, moderatorId: interaction.user.id });
      const count     = db.strikes.count({ userId: target.id, guildId: interaction.guild.id });
      const threshold = db.settings.getStrikeThreshold(interaction.guild.id);

      let dmStatus = '❌ Could not send';
      try {
        await target.send(`⚠️ You received a strike in **${interaction.guild.name}**.\n**Reason:** ${reason}\n**Total Strikes:** ${count}${threshold > 0 ? `\n**Auto-BL Threshold:** ${threshold}` : ''}`);
        dmStatus = '✉️ Sent';
      } catch (_) {}

      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle('⚠️ Strike Added')
        .addFields(
          { name: 'User',          value: `<@${target.id}>\n\`${target.id}\``, inline: true },
          { name: 'Total Strikes', value: `${count}${threshold > 0 ? `/${threshold}` : ''}`, inline: true },
          { name: 'DM Status',     value: dmStatus,                            inline: true },
          { name: 'Reason',        value: reason,                              inline: false },
          { name: 'Issued By',     value: `<@${interaction.user.id}>`,         inline: true },
        )
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      const channelId = db.settings.getLogChannel(interaction.guild.id);
      if (channelId) {
        const logChannel = interaction.guild.channels.cache.get(channelId);
        if (logChannel) await logChannel.send({ embeds: [embed] }).catch(() => null);
      }

      // Auto-blacklist if threshold reached
      if (threshold > 0 && count >= threshold) {
        const existing = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });
        if (!existing) {
          const member = await interaction.guild.members.fetch(target.id).catch(() => null);
          if (member) {
            const roles    = member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.id);
            const nickname = member.nickname ?? null;

            const { getOrCreateBlacklistRole } = require('./blacklist');
            const blRole = await interaction.guild.roles.cache.find(r => r.name === '[BLACKLISTED]') ??
              await interaction.guild.roles.create({ name: '[BLACKLISTED]', colors: [0x2b2d31], permissions: [] });

            db.blacklist.create({
              userId: target.id, guildId: interaction.guild.id,
              reason: `Auto-blacklisted: ${count} strikes reached threshold of ${threshold}`,
              category: 'Appealable', acceptedBy: interaction.client.user.id,
              roles, nickname, evidence: null, expiresAt: null,
            });

            await member.roles.set([blRole]).catch(() => null);
            await member.setNickname(`[BLACKLISTED] ${member.user.username}`).catch(() => null);
            await target.send(`🔨 You have been automatically blacklisted in **${interaction.guild.name}** after reaching ${threshold} strikes.`).catch(() => null);

            const autoEmbed = new EmbedBuilder()
              .setColor(0xe84142)
              .setTitle('🔨 Auto-Blacklisted (Strike Threshold)')
              .setDescription(`<@${target.id}> was automatically blacklisted after reaching **${count}** strikes.`)
              .setTimestamp();

            if (logChannel) await logChannel.send({ embeds: [autoEmbed] }).catch(() => null);
          }
        }
      }
    }

    if (sub === 'remove') {
      await interaction.deferReply({ ephemeral: true });
      const id = interaction.options.getInteger('id');
      const strike = db.strikes.findById(id);
      if (!strike) return interaction.editReply({ content: `❌ Strike \`#${id}\` not found.` });
      if (strike.guildId !== interaction.guild.id) return interaction.editReply({ content: `❌ Strike \`#${id}\` does not belong to this server.` });
      db.strikes.remove(id);
      await interaction.editReply({ content: `✅ Strike \`#${id}\` removed.` });
    }

    if (sub === 'list') {
      await interaction.deferReply({ ephemeral: true });
      const target  = interaction.options.getUser('user');
      const strikes = db.strikes.list({ userId: target.id, guildId: interaction.guild.id });
      const blEntry = db.blacklist.findOne({ userId: target.id, guildId: interaction.guild.id });

      if (!strikes.length) return interaction.editReply({ content: `✅ <@${target.id}> has no strikes.` });

      const lines = strikes.map(s =>
        `\`#${s.id}\` — ${s.reason} — by <@${s.moderatorId}> — <t:${Math.floor(new Date(s.createdAt).getTime()/1000)}:R>${s.caseId ? ` — Case \`${s.caseId}\`` : ''}`
      ).join('\n');

      const threshold = db.settings.getStrikeThreshold(interaction.guild.id);

      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle(`⚠️ Strikes for ${target.username}`)
        .setDescription(lines)
        .addFields(
          { name: 'Total',     value: `${strikes.length}${threshold > 0 ? `/${threshold}` : ''}`, inline: true },
          { name: 'BL Status', value: blEntry ? `🔴 Blacklisted (\`${blEntry.caseId}\`)` : '✅ Not blacklisted', inline: true },
        )
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'threshold') {
      const count = interaction.options.getInteger('count');
      if (count < 0) return interaction.reply({ content: '❌ Threshold must be 0 or higher.', ephemeral: true });
      db.settings.setStrikeThreshold(interaction.guild.id, count);
      await interaction.reply({
        content: count === 0 ? '✅ Auto-blacklist disabled.' : `✅ Members will be auto-blacklisted after **${count}** strikes.`,
        ephemeral: true,
      });
    }
  },
};

module.exports = { strikeCmd, data };
