const { REST, Routes } = require('discord.js');
const { data: blacklistData } = require('./commands/blacklist');
const { data: strikeData } = require('./commands/strikes');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Missing environment variables (TOKEN, CLIENT_ID, GUILD_ID)');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('⏳ Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      {
        body: [
          blacklistData.toJSON(),
          strikeData.toJSON()
        ],
      }
    );
    console.log('✅ Slash commands registered successfully!');
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
})();
