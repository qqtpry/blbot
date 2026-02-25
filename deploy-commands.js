const { REST, Routes } = require('discord.js');
const { data: blacklistData } = require('./commands/blacklist');
const { data: strikeData }    = require('./commands/strikes');

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('⏳ Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [blacklistData.toJSON(), strikeData.toJSON()] },
    );
    console.log('✅ Slash commands registered successfully!');
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
})();
