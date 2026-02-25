const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

const data = new SlashCommandBuilder()
  .setName('strike')
  .setDescription('Strike management')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Add a strike to a member')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for strike').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Remove a strike by ID')
    .addIntegerOption(o => o.setName('id').setDescription('Strike ID').setRequired(true)))

  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('List all strikes for a member')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)));

const strikeCmd = {
  data,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      await interaction.deferReply();
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      db.strikes.add({ userId: target.id, guildId: interaction.guild.id, reason, moderatorId: interaction.user.id });
      const count = db.strikes.count({ userId: target.id, guildId: interaction.guild.id });

      // DM the user
      let dmStatus = '❌ Could not send';
      try {
        await target.send(`⚠️ You have received a strike in **${interaction.guild.name}**.\n**Reason:** ${reason}\n**Total Strikes:** ${count}`);
        dmStatus = '✉️  Sent successfully';
      } catch (_) {}

      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle('⚠️  Strike Added')
        .addFields(
          { name: 'User',          value: `<@${target.id}>\n\`${target.id}\``, inline: true },
          { name: 'Total Strikes', value: `${count}`,                          inline: true },
          { name: 'DM Status',     value: dmStatus,                            inline: true },
          { name: 'Reason',        value: reason,                              inline: false },
          { name: 'Issued By',     value: `<@${interaction.user.id}>`,         inline: true },
        )
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Send to log channel
      const channelId = db.settings.getLogChannel(interaction.guild.id);
      if (channelId) {
        const logChannel = interaction.guild.channels.cache.get(channelId);
        if (logChannel) await logChannel.send({ embeds: [embed] }).catch(() => null);
      }
    }

    if (sub === 'remove') {
      await interaction.deferReply({ ephemeral: true });
      const id = interaction.options.getInteger('id');
      db.strikes.remove(id);
      await interaction.editReply({ content: `✅ Strike \`#${id}\` removed.` });
    }

    if (sub === 'list') {
      await interaction.deferReply({ ephemeral: true });
      const target  = interaction.options.getUser('user');
      const strikes = db.strikes.list({ userId: target.id, guildId: interaction.guild.id });

      if (!strikes.length) return interaction.editReply({ content: `✅ <@${target.id}> has no strikes.` });

      const lines = strikes.map(s =>
        `\`#${s.id}\` — ${s.reason} — by <@${s.moderatorId}> — <t:${Math.floor(new Date(s.createdAt).getTime() / 1000)}:R>`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle(`⚠️  Strikes for ${target.username} — ${strikes.length} total`)
        .setDescription(lines)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },
};

module.exports = { strikeCmd, data };
