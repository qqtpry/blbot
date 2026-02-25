const { SlashCommandBuilder, EmbedBuilder, ActivityType } = require('discord.js');

const OWNER_ID = '867870677914353696';

const STATUSES = {
  up:          { label: '🟢 Online',      activity: '🟢 Online',      status: 'online' },
  maintenance: { label: '🟡 Maintenance', activity: '🟡 Maintenance', status: 'idle' },
  down:        { label: '🔴 Down',        activity: '🔴 Down',        status: 'dnd' },
};

const data = new SlashCommandBuilder()
  .setName('botstatus')
  .setDescription('Set the bot status (owner only)')
  .addStringOption(o => o.setName('status').setDescription('Status to set').setRequired(true)
    .addChoices(
      { name: '🟢 Online',      value: 'up' },
      { name: '🟡 Maintenance', value: 'maintenance' },
      { name: '🔴 Down',        value: 'down' },
    ));

const statusCmd = {
  data,
  async execute(interaction) {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: '❌ Only the bot owner can use this command.', ephemeral: true });
    }

    const choice = interaction.options.getString('status');
    const s      = STATUSES[choice];

    await interaction.client.user.setPresence({
      activities: [{ name: s.activity, type: ActivityType.Custom }],
      status: s.status,
    });

    const embed = new EmbedBuilder()
      .setColor(choice === 'up' ? 0x3ba55c : choice === 'maintenance' ? 0xfaa61a : 0xe84142)
      .setTitle('Bot Status Updated')
      .setDescription(`Status set to **${s.label}**`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

module.exports = { statusCmd, data };
