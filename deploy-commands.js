process.env.TOKEN = 'MTQ3NTY1MzI2OTg2MTk1Nzc1Mg.GUSLIw.MaVqaPt_qLgkP5RnthRS8-puJH7xbZ_8S_x2Bs';
process.env.CLIENT_ID = '1475653269861957752';
process.env.GUILD_ID  = '1459348497445687433';

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
