const Discord = require('discord.js');
require('dotenv').config();
const client = new Discord.Client();

const MCSERVER = process.env.MCSERVER
const LOGS_FILE = MCSERVER + "/server/logs/latest.txt"

CHANNEL_IDS = {
	'announcements': "837407841220165652",
	//'chat': "837391785768255488"
}

var announcements = null;
//var chat = null;

module.exports = {
	connect: function()
	{
		client.login(process.env.DISCORD_BOT_TOKEN);
	},

	disconnect: function()
	{
		console.log("Disconnected bot from Discord server");
		client.user.setStatus('offline').then(() => client.destroy());
	},

	send_announcement: function(message)
	{
		if (announcements == null)
		{
			console.log("The announcements channel was not acquired")
			return;
		}

		announcements.send(message)
	},

	forward_chat: function(log)
	{
		if (chat == null)
		{
			console.log("The chat channel was not acquired")
			return;
		}

		tokens = log.split(' ');

		if (!tokens[3].startsWith('<'))  // FIXME: Breaks on server startup
		{
			return;   // this was not a chat log
		}

		tokens = tokens.slice(3, tokens.length);
		chat.send(tokens.join(' '));
	}
};


client.on('ready', function()
{
	console.log("Connected bot to Discord server");
	client.user.setStatus('online');

	const channels = client.channels.cache;
	announcements = channels.get(CHANNEL_IDS['announcements']);
	//chat = channels.get(CHANNEL_IDS['chat']);
});

client.on('disconnect', function()
{
	console.log("Disconnected bot from Discord server");
	client.user.setStatus('offline');
});

/*
client.on('message', function(msg)
{

});
*/
