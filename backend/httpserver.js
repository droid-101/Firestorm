const http = require("http");
const fs = require("fs");
const path = require('path');
const pidusage = require('pidusage');
const spawn = require('child_process').spawn;
const exec = require('child_process').exec;
const WebSocket = require('ws');
const DiscordBot = require('./discord-bot');
const util = require('util');

const PRIVATE_PORT = 8080;
const PUBLIC_PORT = 8000;
const SHUTDOWN_DELAY_MS = 30000;   // Wait 10s before stopping server and shutting down

const MCSERVER = process.env.MCSERVER

var server = null;
var error = false;
var commandOutput = null;
var socketServer = null;
var terminalSocket = null;
var streamTerminal= false;
var backingUp = false;
var deletingWorld = false;

const PATHS = {
	'server':    MCSERVER + "/server/",
	'temp':      MCSERVER + "/temp/",
	'archive':   MCSERVER + "/archive/",
	'backups':   MCSERVER + "/backups/",
	'worlds':    MCSERVER + "/worlds/",
	'tools':     MCSERVER + "/repo/tools/",
	'frontend':  MCSERVER + "/repo/frontend/",
}

const SCRIPTS = {
	'add-world':       PATHS['tools'] + "add-world.py",
	'archive-world':   PATHS['tools'] + "archive-world.py",
	'backup-worlds':   PATHS['tools'] + "backup-worlds.py",
	'set-world':       PATHS['tools'] + "set-world.py",
	'system-stats':    PATHS['tools'] + "system-stats.py"
}

const FILES = {
	'server.properties':   PATHS['server'] + "server.properties",
	'whitelist.json':      PATHS['server'] + "whitelist.json",
	'ops.json':            PATHS['server'] + "ops.json",
	'ram.txt':             PATHS['server'] + "ram.txt",
	'ip.txt':              PATHS['server'] + "ip.txt"
}

const CONTENT_TYPES = {
	".css": "text/css",
	".js": "text/javascript",
	".png": "image/png"
};

const PRIVATE_REQUESTS = [
	"/ram",
	"/properties",
	"/addPlayer",
	"/removePlayer",
	"/op",
	"/deop",
	"/deleteWorld",
	"/backupWorlds",
	"/shutdown",
	"/ops",
	"/systemStats",
	"/serverRAM"
]

process.chdir(PATHS['server']);

var privateWebsite = http.createServer(requestHandler);
openSocketServer();
privateWebsite.listen(PRIVATE_PORT);

var publicWebsite = http.createServer(requestHandler)
publicWebsite.listen(PUBLIC_PORT);

DiscordBot.connect();
checkIP();

function isPrivateRequest(target)
{
	for (let i = 0; i < PRIVATE_REQUESTS.length; i++)
	{
		if (target == PRIVATE_REQUESTS[i])
		{
			return true;
		}
	}

	return false;
}

function requestHandler(request, response)
{
	let target = request.url;
	let body = [];
	let serverType = "";

	if (this === privateWebsite)
	{
		serverType = "private";
	}
	else if (this === publicWebsite)
	{
		serverType = "public";
	}

	console.log(serverType, request.method, target);

	if (request.method == "POST")
	{
		if (serverType == "public" && isPrivateRequest(target))
		{
			return;   // deny any unauthorized requests
		}

		if (backingUp || deletingWorld)
		{
			return;   // deny requests during a backup or world deletion
		}

		request.on('data', (chunk) => {body.push(chunk)});
		request.on('end',
			function()
			{
				body = Buffer.concat(body)

				if (target != "/addWorld")
				{
					body = body.toString();
				}

				if (target == "/start")
				{
					startServer();
				}
				else if (target == "/stop")
				{
					stopServer();
				}
				else if (target == "/restart")
				{
					restartServer();
				}
				else if (target == "/ram")
				{
					fs.writeFile(FILES['ram.txt'], body,
						function(err)
						{
							if (err)
							{
								return console.log(err);
							}
						}
					);
				}
				else if (target == "/properties")
				{
					let properties = JSONtoProperties(body);

					fs.writeFile(FILES['server.properties'], properties,
						function(err)
						{
							if (err)
							{
								return console.log(err);
							}
						}
					);
				}
				else if (target == "/addPlayer")
				{
					serverCommand("/whitelist add " + body);
				}
				else if (target == "/removePlayer")
				{
					serverCommand("/deop " + body);
					serverCommand("/whitelist remove " + body);
				}
				else if (target == "/op")
				{
					serverCommand("/op " + body);
				}
				else if (target == "/deop")
				{
					serverCommand("/deop " + body);
				}
				else if (target == "/setWorld")
				{
					setWorld(body);
				}
				else if (target == "/addWorld")
				{
					if (serverRunning())
					{
						console.log("Cannot add world: Server is running");
						return;
					}

					fileName = request.headers['file-name']

					fs.writeFile(PATHS['temp'] + fileName, body,
						function(err)
						{
							if (err)
							{
								return console.log(err);
							}

							let addWorld = spawn(SCRIPTS['add-world'], [fileName]);

							addWorld.stdout.on('data',
								function(data)
								{
									console.log(data.toString());
								}
							);

							addWorld.on('close',
								function(code)
								{
									console.log("Attempted to add a new world");
								}
							);
						}
					);
				}
				else if (target == "/deleteWorld")
				{
					if (serverRunning())
					{
						console.log("Cannot delete world: Server is running");
						return;
					}

					if (deletingWorld)
					{
						console.log("A world deletion is already in progress");
						return;
					}

					let deleteWorld = spawn(SCRIPTS['archive-world'], [body]);
					deletingWorld = true;

					deleteWorld.stdout.on('data',
						function(data)
						{
							console.log(data.toString());
						}
					);

					deleteWorld.on('close',
						function(code)
						{
							deletingWorld = false;
							console.log("Attempted to archive world")
						}
					);
				}
				else if (target == "/backupWorlds")
				{
					if (serverRunning())
					{
						console.log("Cannot backup worlds: Server is running");
						return;
					}

					if (backingUp)
					{
						console.log("A backup is already in progress");
						return;
					}

					let backup = spawn(SCRIPTS['backup-worlds']);
					backingUp = true;

					backup.stdout.on('data',
						function(data)
						{
							console.log(data.toString())
						}
					);

					backup.on('close',
						function(code)
						{
							backingUp = false;
							console.log("Worlds backed up")
						}
					);
				}
				else if (target == "/shutdown")
				{
					if (serverRunning())
					{
						serverCommand("/say The server is shutting down for the day");
						serverCommand("/say All players will be disconnected in " + (SHUTDOWN_DELAY_MS / 1000) + " seconds");
					}

					privateWebsite.close();
					publicWebsite.close();
					DiscordBot.disconnect();

					setTimeout(function()
					{
						stopServer();
						console.log("Waiting for Minecraft server to stop");
						while (serverRunning());
						console.log("Shutting down Firestorm");
						exec('sudo shutdown', function(error, stdout, stderr){ console.log(stdout); });
						// The server will power off 1 minute after executing 'sudo shutdown'
					}
					, SHUTDOWN_DELAY_MS);
				}
			}
		);
	}
	else if (request.method == "GET")
	{
		response.setHeader("Access-Control-Allow-Origin", "*");

		if (serverType == "public" && isPrivateRequest(target))
		{
			IWillFindYou(response, serverType);   // deny any unauthorized requests
			return;
		}

		if (backingUp || deletingWorld)
		{
			BabyYoda(response, serverType);   // deny requests during a backup or world deletion
			return;
		}

		if (target == "/mcserver")
		{
			fs.readFile(PATHS['frontend'] + serverType + "/structure.html",
				function(err, data)
				{
					if (err)
					{
						throw err;
					}

					response.writeHead(200, {"Content-Type": "text/html"});
					response.write(data);
					response.end();
				}
			);
		}
		else if (target == "/properties")
		{
			fs.readFile(FILES['server.properties'],
				function(err, data)
				{
					if (err)
					{
						throw err;
					}

					data = propertiesToJSON(data.toString());
					response.writeHead(200, {"Content-Type": "text/plain"});
					response.write(data);
					response.end();
				}
			);
		}
		else if (target == "/whitelist")
		{
			fs.readFile(FILES['whitelist.json'],
				function(err, data)
				{
					if (err)
					{
						throw err;
					}

					response.writeHead(200, {"Content-Type": "text/plain"});
					response.write(data.toString());
					response.end();
				}
			);
		}
		else if (target == "/ops")
		{
			fs.readFile(FILES['ops.json'],
				function(err, data)
				{
					if (err)
					{
						throw err;
					}

					response.writeHead(200, {"Content-Type": "text/plain"});
					response.write(data.toString());
					response.end();
				}
			);
		}
		else if (target == "/worlds")
		{
			let getWorlds = spawn('ls', ['-1', PATHS['worlds']]);
			let worlds = "";

			getWorlds.stdout.on('data',
				function(data)
				{
					worlds += data.toString();
				}
			);

			getWorlds.on('close',
				function(code)
				{
					worlds = worlds.split("\n");

					for (var i = 0; i < worlds.length; i++)
					{
						worlds[i] = worlds[i].replace(/'/g, "");

						if (worlds[i] == "")
						{
							worlds.splice(i, 1);
						}
					}

					response.writeHead(200, {"Content-Type": "text/plain"});
					response.write(JSON.stringify(worlds, null, '\t'));
					response.end();
				}
			);
		}
		else if (target == "/currentWorld")
		{
			currentWorld(response);
		}
		else if (target == "/ram")
		{
			fs.readFile(FILES['ram.txt'],
				function(err, data)
				{
					if (err)
					{
						return console.log(err);
					}

					response.writeHead(200, {"Content-Type": "text/plain"});
					response.write(data.toString());
					response.end();
				}
			);
		}
		else if (target == "/playersOnline")
		{
			response.writeHead(200, {"Content-Type": "text/plain"});
			playersOnline(response);
		}
		else if (target == "/systemStats")
		{
			let stats = spawn(SCRIPTS['system-stats']);
			let report = {
				'cpu': -1,
				'ram': -1,
				'ip': -1
			};

			stats.stdout.on('data',
				function(data)
				{
					data = data.toString().split(' ');
					report['cpu'] = data[0];
					report['ram'] = data[1];
					report['ip'] = data[2].trim();
				}
			);

			stats.on('close',
				function(code)
				{
					response.writeHead(200, {"Content-Type": "text/plain"});
					response.write(JSON.stringify(report, null, '\t'));
					response.end();
				}
			);
		}
		else if (target == "/serverRAM")
		{
			serverRAM(response);
		}
		else if (target == "/status")
		{
			let currentStatus = "";

			if (error)
			{
				currentStatus = "error";
			}
			else if (serverRunning())
			{
				currentStatus = "online";
			}
			else
			{
				currentStatus = "offline";
			}

			console.log("Server status: " + currentStatus);

			response.writeHead(200, {"Content-Type": "text/plain"});
			response.write(currentStatus);
			response.end();
		}
		else
		{
			getFrontendResource(target, response, serverType);
		}
	}
}

function serverRunning()
{
	if (server == null)
	{
		return false;
	}

	if (server.exitCode == null)
	{
		return true;
	}

	return false;
}

function startServer()
{
	if (serverRunning())
	{
		console.log("The server is currently running!");
		return;
	}

	let ram;

	fs.readFile(FILES['ram.txt'],
		function(err, data)
		{
			if (err)
			{
				return console.log(err);
			}

			ram = (data.toString());

			server = spawn('java', ['-Xmx' + ram + "M", '-Xms' + ram + "M", '-jar', 'server.jar', 'nogui']);

			server.stdin.setEncoding('utf-8');
			console.log("Minecraft server starting with " + ram + " of RAM");

			server.stdout.on('data', (data) => {
				commandOutput = (`${data}`);
				console.log(commandOutput);
				sendTerminalOutput(commandOutput);
				//DiscordBot.forward_chat(commandOutput)
			});

			server.stderr.on('data', (data) => {
			console.error(`${data}`);
			});

			server.on('close', (code) => {
			console.log(`Minecraft server stopped with exit code (${code})`);
			});
		}
	);
}

function serverCommand(command)
{
	if (!serverRunning())
	{
		console.log("Server is offline: Command cannot be executed");
		return;
	}

	server.stdin.write(command + "\n");
}

function stopServer()
{
	if (!serverRunning())
	{
		console.log("The server is not running!");
		return;
	}

	console.log("Stopping Minecraft server");

	serverCommand("/stop")
	server = null;
}


function restartServer()
{
	if (!serverRunning())
	{
		console.log("The server is not running!");
		return;
	}

	stopServer();
	console.log("Waiting for server to stop.");

	while (serverRunning());
	startServer();
}

function propertiesToJSON(properties)
{
	var jsonData = {};
	var entry = [];
	let key = "";
	let value = "";

	properties = properties.split("\n");

	for (let i = 0; i < properties.length - 1; i++)
	{
		entry = properties[i].split("=");
		key = entry[0];
		value = entry[1];
		jsonData[key] = value;
	}

	jsonData = JSON.stringify(jsonData, null, '\t');
	return jsonData;
}

function JSONtoProperties(jsonData)
{
	let properties = "#Minecraft Server Settings\n";
	jsonData = JSON.parse(jsonData);

	for (key in jsonData)
	{
		properties = properties.concat(key, "=", jsonData[key], "\n");
	}

	return properties;
}

function setWorld(name)
{
	if (serverRunning())
	{
		console.log("Server running: World cannot be changed");
		return;
	}

	let setWorld = spawn(SCRIPTS['set-world'], [name]);

	setWorld.stdout.on('data',
		function(data)
		{
			console.log(`${data}`);
		}
	);
}

function currentWorld(response)
{
	let current = spawn('ls', ['-l', "world"]);
	let world = "";

	current.stdout.on('data',
		function(data)
		{
			data = data.toString();
			data = data.split("\n")[0];
			data = data.split("/");
			world = data[data.length - 1];
		}
	);

	current.on('close',
		function(code)
		{
			response.writeHead(200, {"Content-Type": "text/plain"});
			response.write(world);
			response.end();
		}
	);
}

function playersOnline(response)
{
	report = {
		'online': -1,
		'max': -1,
		'status': "OFFLINE",
		'players': "UNKNOWN",
	}

	if (!serverRunning())
	{
		console.log("Cannot get player count: Server is offline")
		response.write(JSON.stringify(report, null, '\t'));
		response.end();
		return;
	}

	let status = "ONLINE"
	serverCommand("/list");

	setTimeout(function()
	{
		let output = commandOutput;

		if (output == null || output.match(/players online:/gi) == null)
		{
			response.write(JSON.stringify(report, null, '\t'));
			console.log("Failed to get player online count")
		}
		else
		{
			let online = parseInt(output.split(" ")[5]);
			let max = parseInt(output.split(" ")[10]);
			let players = "";

			if (online == 0)
			{
				players = "None";
			}
			else
			{
				players = output.split(": ")[2];
				players = players.split("\n")[0];
				players = players.split(", ");
			}

			report['online'] = online;
			report['max'] = max;
			report['players'] = players;
			report['status'] = status;

			console.log("Sending player online count");
			response.write(JSON.stringify(report, null, '\t'));
		}

		response.end()
	}
	, 500);
}

function serverRAM(response)
{
	if (serverRunning())
	{
		pidusage(server.pid,
			function(err, stats)
			{
				let usage = (stats["memory"] * Math.pow(10, -9));
				usage = Math.round(usage * 10) / 10;
				usage = usage.toString() + "GB"
				response.writeHead(200, {"Content-Type": "text/plain"});
				response.write(usage)
				response.end();
			}
		);
	}
	else
	{
		response.writeHead(200, {"Content-Type": "text/plain"});
		response.write("Server Offline")
		response.end();
	}
}

function IWillFindYou(response, serverType)
{
	fs.readFile(PATHS['frontend'] + serverType + "/pictures/IWillFindYou.png",
		function(err, data)
		{
			if (err)
			{
				response.writeHead(404);
			}
			else
			{
				response.writeHead(404, {"Content-Type": "image/png"});
				response.write(data);
			}

			response.end();
		}
	);
}

function BabyYoda(response, serverType)
{
	fs.readFile(PATHS['frontend'] + serverType + "/pictures/BabyYoda.png",
		function(err, data)
		{
			if (err)
			{
				response.writeHead(404);
			}
			else
			{
				response.writeHead(404, {"Content-Type": "image/png"});
				response.write(data);
			}

			response.end();
		}
	);
}

function getFrontendResource(target, response, serverType)
{
	let ext = path.extname(target);
	let type = CONTENT_TYPES[ext];
	let filePath = PATHS['frontend'] + serverType + target;

	fs.readFile(filePath,
		function(err, data)
		{
			if (err)
			{
				IWillFindYou(response, serverType);
				return;
			}

			response.writeHead(200, {"Content-Type": type});
			response.write(data);
			response.end();
		}
	);
}

function openSocketServer()
{
	socketServer = new WebSocket.Server({ server: privateWebsite })

	socketServer.on('connection',
		function(socket)
		{
			socket.on('message',
				function(message)
				{
					let command = `${message}`;
					console.log("Received command " + command);

					if (command == "stop" || command == "/stop")
					{
						terminalSocket.send("Please use the STOP button");
					}
					else
					{
						serverCommand(command);
					}
				}
			);

			streamTerminal = true;
			terminalSocket = socket;
			console.log("Connected server console to client")
			terminalSocket.send("Connected to Minecraft server console .......")
		}
	);
}

function sendTerminalOutput(data)
{
	if (!streamTerminal)
	{
		return;
	}

	terminalSocket.send(data)
}

function checkIP()
{
	fs.readFile(FILES['ip.txt'], function(err, data)
	{
		if (err)
		{
			throw err;
		}

		existing = data.toString().trim();

		let stats = spawn(SCRIPTS['system-stats']);

		stats.stdout.on('data', function(data)
		{
			data = data.toString().split(' ');
			newest = data[2].trim()

			console.log("The existing IP address is: " + existing);
			console.log("The newest IP address is: " + newest);

			if (existing === newest)
			{
				console.log("The IP address has not changed from '%s'", existing);
				return;
			}

			console.log("The IP address has changed from '%s' to '%s'", existing, newest);

			fs.writeFile(FILES['ip.txt'], newest, function(err)
			{
				if (err)
				{
					return console.log(err);
				}

				console.log("Updated the saved IP");
				console.log("The new IP will be posted on Discord");

				fs.readFile(FILES['server.properties'], function(err, data)
				{
					if (err)
					{
						throw err;
					}

					properties = JSON.parse(propertiesToJSON(data.toString()))
					mcserver = util.format("%s:%s", newest, properties['server-port'])
					website = util.format("http://%s/mcserver", newest);
					DiscordBot.send_announcement(util.format("The IP address has changed.\nServer: `%s`\nWebsite: %s", mcserver, website));
				});
			});
		});
	});
}
