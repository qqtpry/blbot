const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActivityType } = require('discord.js');
const { blacklistCmd } = require('./commands/blacklist');
const { strikeCmd }    = require('./commands/strikes');
const { statusCmd }    = require('./commands/status');
const db               = require('./database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = new Collection();
client.commands.set('blacklist', blacklistCmd);
client.commands.set('strike',    strikeCmd);
client.commands.set('botstatus', statusCmd);

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Set default status to online
  await client.user.setPresence({
    activities: [{ name: '🟢 Online', type: ActivityType.Custom }],
    status: 'online',
  });

  console.log('🔍 Running startup BL role check...');
  for (const [, guild] of client.guilds.cache) {
    try {
      const entries = db.blacklist.list(guild.id);
      if (!entries.length) continue;
      const blRole = guild.roles.cache.find(r => r.name === '[BLACKLISTED]');
      if (!blRole) continue;
      for (const entry of entries) {
        const member = await guild.members.fetch(entry.userId).catch(() => null);
        if (!member) continue;
        if (!member.roles.cache.has(blRole.id)) {
          await member.roles.set([blRole]).catch(() => null);
          await member.setNickname(`[BLACKLISTED] ${member.user.username}`).catch(() => null);
          console.log(`🔒 Re-applied BL to ${member.user.tag} in ${guild.name}`);
        }
      }
    } catch (err) {
      console.error(`Startup check error in ${guild.name}:`, err);
    }
  }
  console.log('✅ Startup check complete.');

  setInterval(async () => {
    const expired = db.blacklist.getExpired();
    for (const entry of expired) {
      const guild = client.guilds.cache.get(entry.guildId);
      if (!guild) continue;
      const target = await client.users.fetch(entry.userId).catch(() => null);
      const member = await guild.members.fetch(entry.userId).catch(() => null);
      if (member) {
        const blRole     = guild.roles.cache.find(r => r.name === '[BLACKLISTED]');
        const validRoles = entry.roles.filter(id => guild.roles.cache.has(id) && id !== blRole?.id);
        await member.roles.set(validRoles).catch(() => null);
        await member.setNickname(entry.nickname ?? null).catch(() => null);
      }
      db.blacklist.delete({ userId: entry.userId, guildId: entry.guildId, moderatorId: client.user.id, reason: 'Temporary blacklist expired' });
      if (target) await target.send(`✅ Your temporary blacklist has expired and been automatically lifted.`).catch(() => null);
      const channelId = db.settings.getLogChannel(entry.guildId);
      if (channelId) {
        const logChannel = guild.channels.cache.get(channelId);
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setColor(0x3ba55c)
            .setTitle('⏰ Temporary BL Expired')
            .setDescription(`<@${entry.userId}>'s temporary blacklist has expired.`)
            .addFields({ name: 'Original Reason', value: entry.reason })
            .setTimestamp();
          await logChannel.send({ embeds: [embed] }).catch(() => null);
        }
      }
    }
  }, 5 * 60 * 1000);
});

client.on('guildMemberAdd', async member => {
  const entry = db.blacklist.findOne({ userId: member.id, guildId: member.guild.id });
  if (!entry) return;
  const blRole = member.guild.roles.cache.find(r => r.name === '[BLACKLISTED]');
  if (blRole) {
    await member.roles.add(blRole).catch(() => null);
    await member.setNickname(`[BLACKLISTED] ${member.user.username}`).catch(() => null);
  }
  await member.send(`🔨 You are still blacklisted in **${member.guild.name}**.\n**Reason:** ${entry.reason}`).catch(() => null);
  const channelId = db.settings.getLogChannel(member.guild.id);
  if (channelId) {
    const logChannel = member.guild.channels.cache.get(channelId);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xe84142)
        .setTitle('🔄 Blacklisted Member Rejoined')
        .setDescription(`<@${member.id}> tried to rejoin but is still blacklisted.`)
        .addFields({ name: 'Original Reason', value: entry.reason })
        .setTimestamp();
      await logChannel.send({ embeds: [embed] }).catch(() => null);
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error('Command error:', err);
    const msg = { content: '❌ An error occurred. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => null);
    else await interaction.reply(msg).catch(() => null);
  }
});

client.login(process.env.TOKEN);
