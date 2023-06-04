const HOSTNAME = document.location.hostname;
const PORT = document.location.port;
const SERVER_URL = "http://" + HOSTNAME + ":" + PORT;
const SOCKET_URL = "ws://" + HOSTNAME + ":" + PORT;
const PICTURE_COUNT = 14;
var propertiesEditable = true;
var addingPlayer = false;
var worlds = {};
var playerList = {};
var statRefresh;
var playerRefresh;
var terminalSocket = null
var terminalConnected = false;
var serverPort;
var opacity;
var slideshow;
var slide = 13;

function switchTab(name)
{
	clearInterval(statRefresh);
	clearInterval(playerRefresh);
	clearInterval(slideshow);
	var tabs = document.getElementsByClassName("tab");

	for (var i = 0; i < tabs.length; i++)
	{
		tabs[i].style.display = "none";
	}

	if (name == "settings")
	{
		requestData("properties",
			function(target)
			{
				document.getElementById("properties").innerHTML = "";
				let properties = JSON.parse(target);
				for (key in properties)
				{
					let line = "<p>";
					line = line.concat(key, " = ", properties[key]);
					line += "</p>";

					document.getElementById("properties").innerHTML += line;
				}
			}
		);
	}
	else if (name == "dashboard")
	{
		getStats();

		statRefresh = setInterval(function()
		{
			getStats();
		}
		, 10000);
	}
	else if (name == "players")
	{
		playerList = {};
		playerRefresh = setInterval(function()
		{
			getPlayers("players");
		}
		, 30000);

		requestData("whitelist",
			function(target)
			{
				document.getElementById("whitelist").innerHTML = "";
				let whitelist = JSON.parse(target);
				for (player in whitelist)
				{
					let line = "<p>";
					line += whitelist[player]["name"];
					line += "<button class='deletePlayer' id='delete-" + whitelist[player]["name"] + "' onclick='removePlayer(this.id)'>-</button>";
					line += "<label class='switch'><input type='checkbox' id='op-" + whitelist[player]["name"] + "' oninput='editOps(this.id)'><span class='switch-slider round'></span></label>";
					line += "<span class='onlineStatus' id='online-" + whitelist[player]["name"] + "'></span>"
					line += "</p>";

					document.getElementById("whitelist").innerHTML += line;
					playerList[player] = whitelist[player]["name"];
				}

				getPlayers("players");

				document.getElementById("newPlayer").style.display = "none";
				document.getElementById("savePlayers").style.display = "none";
			}
		);

		setTimeout(function()
		{
			requestData("ops",
				function(target)
				{
					let ops = JSON.parse(target);
					for (player in ops)
					{
						document.getElementById("op-" + ops[player]["name"]).checked = true;
					}
				}
			);
		}
		, 500);
	}
	else if (name == "worlds")
	{
		requestData("worlds",
			function(target)
			{
				document.getElementById("world-list").innerHTML = "";

				if (target == "")
				{
					return;
				}

				target = JSON.parse(target);

				for (let i = 0; i < target.length; i++)
				{
					let line = "<p>";
					line += "<button class='world' id='setWorld*" + target[i] + "' onclick='selectWorld(\"" + target[i] + "\")'>" + target[i] + "</button>";
					line += "<button class='deleteWorld' id='delete*" + target[i] + "' onclick='deleteWorld(this.id)'>-</button>";
					line += "</p>";
					document.getElementById("world-list").innerHTML += line;

					worlds[i] = target[i];
				}

				getCurrentWorld("worlds");
			}
		);
	}
	else if (name == "home")
	{
		slideshow = setInterval(function()
		{
			changeSlide("pic" + slide);
		}
		, 8000);
	}

	document.getElementById(name).style.display = "block";
}


function pressButton(action)
{
	sendData(action, "");
	setTimeout(getStatus, 5000);
}

function generateURL(action)
{
	return SERVER_URL + "/" + action;
}

function requestData(target, handler)
{
	var request = new XMLHttpRequest();
	request.timeout = 10000;
	request.open("GET", generateURL(target));
	request.send(null);

	request.onreadystatechange = function()
	{
		if (request.readyState == 4 && request.status == 200)
		{
			handler(request.response);
		}
	}

	request.ontimeout = function()
	{
		console.log("Request timed out.");
	}
}

function sendData(target, data)
{
	var request = new XMLHttpRequest();
	request.timeout = 10000;
	request.open("POST", generateURL(target));
	request.setRequestHeader("Content-Type", "text/plain");
	request.send(data);
}

function sendWorld(file)
{
	var request = new XMLHttpRequest();
	request.timeout = 10000;
	request.open("POST", generateURL("addWorld"));
	request.setRequestHeader("Content-Type", "application/x-zip-compressed");
	request.setRequestHeader("file-name", file.name);
	request.send(file);
}

function getStatus()
{
	requestData("status",
		function(target)
		{
			let result = "";
			let colour = "";

			if (target == "online")
			{
				result = "ONLINE";
				colour = "rgb(22, 158, 22)";
			}
			else if (target == "offline")
			{
				result = "OFFLINE";
				colour = "rgb(100, 100, 100)";
			}
			else
			{
				result = "ERROR";
				colour = "rgb(180, 16, 16)";
			}

			document.getElementById("status").innerHTML = result;
			document.getElementById("status").style.color = colour;
			document.getElementById("status").style.borderColor = colour;
		}
	);
}

function setValue(value)
{
	document.getElementById("allocated-ram").innerHTML = "Allocated RAM: " + value + "GB";
}

function sendRAM()
{
	let value = document.getElementById("slider").value;
	sendData("ram", value.toString());
}

function getRAM()
{
	requestData("ram",
		function(target)
		{
			document.getElementById("allocated-ram").innerHTML = "Allocated RAM: " + target  + "GB";
			document.getElementById("slider").value = target;
		}
	);
}

function editProperties()
{
	document.getElementById("properties").innerHTML = "";
	requestData("properties",
		function(target)
		{
			let properties = JSON.parse(target);

			if (propertiesEditable)
			{
				propertiesEditable = false;
				document.getElementById("editProperties").innerHTML = "CANCEL";
				document.getElementById("editProperties").style.backgroundColor = "red";
				document.getElementById("save").innerHTML = "<button class='save-changes' onclick='saveProperties()'>SAVE</button>";

				for (key in properties)
				{
					let boxID = "edit-" + key;
					let line = "<p>";
					line = line.concat(key, " = ");
					line += "<input class='changeProperty' id=" + boxID + " type='text' value='" + properties[key] + "'></input>";
					line += "</p>";

					document.getElementById("properties").innerHTML += line;
				}
			}
			else
			{
				propertiesEditable = true;
				document.getElementById("editProperties").innerHTML = "EDIT";
				document.getElementById("editProperties").style.backgroundColor = "rgb(22, 116, 179)";
				document.getElementById("save").innerHTML = "";

				for (key in properties)
				{
					let line = "<p>";
					line = line.concat(key, " = ", properties[key]);
					line += "</p>";

					document.getElementById("properties").innerHTML += line;
				}
			}
		}
	);
}

function saveProperties()
{
	requestData("properties",
		function(target)
		{
			let properties = JSON.parse(target);

			for (key in properties)
			{
				let boxID = "edit-" + key;
				properties[key] = document.getElementById(boxID).value;
			}

			console.log("properties: " + JSON.stringify([properties]))
			console.log(properties);

			sendData("properties", JSON.stringify(properties));
			propertiesEditable = false;

			setTimeout(function() {editProperties();}, 1000);
		}
	);
}

function toggleAdd()
{
	if (!addingPlayer)
	{
		document.getElementById("newPlayer").style.display = "block";
		document.getElementById("newPlayer").value = "";
		addingPlayer = true;
		document.getElementById("addPlayer").style.backgroundColor = "red";
		document.getElementById("addPlayer").innerHTML = "CANCEL";
		document.getElementById("addPlayer").style.width = "130px";
		document.getElementById("savePlayers").style.display = "inline";
	}
	else
	{
		addingPlayer = false;
		document.getElementById("addPlayer").style.backgroundColor = "rgb(55, 168, 55)";
		document.getElementById("addPlayer").innerHTML = "+";
		document.getElementById("addPlayer").style.width = "40px";
		document.getElementById("newPlayer").style.display = "none";
		document.getElementById("savePlayers").style.display = "none";
	}
}

function addPlayer()
{
	playerList = {};
	let player = document.getElementById("newPlayer").value;
	sendData("addPlayer", player);

	addingPlayer = true;
	setTimeout(function()
	{
		requestData("whitelist",
			function(target)
			{
				document.getElementById("whitelist").innerHTML = "";
				let whitelist = JSON.parse(target);
				for (player in whitelist)
				{
					let line = "<p>";
					line += whitelist[player]["name"];
					line += "<button class='deletePlayer' id='delete-" + whitelist[player]["name"] + "' onclick='removePlayer(this.id)'>-</button>";
					line += "<label class='switch'><input type='checkbox' id='op-" + whitelist[player]["name"] + "' oninput='editOps(this.id)'><span class='switch-slider round'></span></label>";
					line += "<span class='onlineStatus' id='online-" + whitelist[player]["name"] + "'></span>";
					line += "</p>";

					document.getElementById("whitelist").innerHTML += line;
					playerList[player] = whitelist[player]["name"];
				}

				toggleAdd();
				getPlayers("players");
			}
		);

		requestData("ops",
			function(target)
			{
				let ops = JSON.parse(target);
				for (player in ops)
				{
					document.getElementById("op-" + ops[player]["name"]).checked = true;
				}
			}
		);
	} , 500);
}

function removePlayer(id)
{
	playerList = {};
	let player = id.split("-")[1];
	sendData("removePlayer", player);

	setTimeout(function()
	{
		requestData("whitelist",
			function(target)
			{
				document.getElementById("whitelist").innerHTML = "";
				let whitelist = JSON.parse(target);
				for (player in whitelist)
				{
					let line = "<p>";
					line += whitelist[player]["name"];
					line += "<button class='deletePlayer' id='delete-" + whitelist[player]["name"] + "' onclick='removePlayer(this.id)'>-</button>";
					line += "<label class='switch'><input type='checkbox' id='op-" + whitelist[player]["name"] + "' oninput='editOps(this.id)'><span class='switch-slider round'></span></label>";
					line += "<span class='onlineStatus' id='online-" + whitelist[player]["name"] + "'></span>";
					line += "</p>";

					document.getElementById("whitelist").innerHTML += line;
					playerList[player] = whitelist[player]["name"];
				}

				getPlayers("players");
			}
		);

		requestData("ops",
			function(target)
			{
				let ops = JSON.parse(target);
				for (player in ops)
				{
					document.getElementById("op-" + ops[player]["name"]).checked = true;
				}
			}
		);
	} , 500);
}

function editOps(id)
{
	let player = id.split("-")[1];

	if (document.getElementById(id).checked)
	{
		sendData("op", player);
	}
	else
	{
		sendData("deop", player);
	}
}

function selectWorld(world)
{
	sendData("setWorld", world);
	setTimeout(switchTab("worlds"), 500)
}

function getCurrentWorld(tab)
{
	requestData("currentWorld",
		function(target)
		{
			if (target == null || target == "")
			{
				return;
			}

			if (tab == "dashboard")
			{
				document.getElementById("active-world").innerHTML = "Active World: " + target;
			}
			else
			{
				document.getElementById("setWorld*" + target).style.color = "rgb(8, 179, 8)";
			}
		}
	);
}

function triggerUpload()
{
	document.getElementById('addWorld').click();
}

function addWorld(file)
{
	file = file[0];
	sendWorld(file);
	setTimeout(switchTab, 2500, "worlds")
}

function deleteWorld(id)
{
	world = id.split("*")[1]
	sendData("deleteWorld", world);
	setTimeout(switchTab, 2500, "worlds")
}

function getPlayers(tab)
{
	requestData("playersOnline",
		function(target)
		{
			for (player in playerList)
			{
				document.getElementById("online-" + playerList[player]).style.backgroundColor = "rgb(212, 212, 212)";
			}

			report = JSON.parse(target);

			if (tab == "players")
			{
				if (report['status'] == "OFFLINE" || report['online'] == 0)
				{
					return;
				}

				for (let i = 0; i < report['players'].length; i++)
				{
					player = report['players'][i];
					document.getElementById("online-" + player).style.backgroundColor = "rgb(40, 224, 23)";
				}
			}
			else if (tab == "dashboard")
			{
				let playerCount = null;

				if (report['status'] == "OFFLINE")
				{
					playerCount = "Server Offline"
				}
				else
				{
					playerCount = report['online'] + " / " + report['max'];
				}

				document.getElementById("player-count").innerHTML = "Player Count: " + playerCount;
			}
		}
	);
}

function getRAMusage()
{
	requestData("serverRAM",
		function(target)
		{
			document.getElementById("server-ram").innerHTML = "Server RAM Usage: " + target;
		}
	);
}

function getSystemStats()
{
	requestData("systemStats",
		function(target)
		{
			let report = JSON.parse(target);
			document.getElementById("cpu-usage").innerHTML = "CPU Usage: " + report['cpu'];
			document.getElementById("linux-ram").innerHTML = "Machine RAM Usage: " + report['ram'];
			document.getElementById("server-ip").innerHTML = "Server IP: " + report['ip'] + ":" + serverPort;
		}
	);
}

function getStats()
{
	getSystemStats();
	getRAMusage();
	getPlayers("dashboard");
	getCurrentWorld("dashboard");
}

function terminalPrint(data)
{
	var terminal = document.getElementById("terminal-window");
	data = data.replace("<", "&lt");
	data = data.replace(">", "&gt");
	terminal.innerHTML += data + "<br/>";
	terminal.scrollTop = terminal.scrollHeight;
}

function terminalSend(data)
{
	if (terminalConnected)
	{
		terminalSocket.send(data);
	}
}

function openTerminalSocket()
{
	terminalSocket = new WebSocket(SOCKET_URL);

	terminalSocket.onopen = function()
	{
		terminalConnected = true;
	}

	terminalSocket.onmessage = function(message)
	{
		terminalPrint(message.data);
	}

	terminalSocket.onerror = function(error)
	{
		console.log(`WebSocket error: ${error}`);
	}

	var prompt = document.getElementById("terminal-prompt");

	prompt.addEventListener("keyup",
		function(event)
		{
			if (event.keyCode === 13)
			{
				event.preventDefault();
				terminalSend(prompt.value);
				prompt.value = "";
			}
		}
	);
}

function getServerPort()
{
	requestData("properties",
		function(target)
		{
			let properties = JSON.parse(target);
			serverPort = properties["server-port"];
		}
	);
}

function backup()
{
	sendData("backupWorlds")
}

function changeSlide(id)
{
	id = id.split("pic")[1];
	id = parseInt(id, 10);

	let newID = id + 1;
	newID = ++newID % PICTURE_COUNT;
	newID = newID.toString();

	id = ++id % PICTURE_COUNT;
	slide = id;
	id = id.toString();

	fade(id, newID);
}

function fade(id, newID)
{
	opacity = 100;
	document.getElementById("pic" + id).style.opacity = opacity + "%";

	let fadeOut = setInterval(function()
	{
		opacity--;
		document.getElementById("pic" + id).style.opacity = opacity + "%";
		document.getElementById("pic" + id).style.display = "block";

		if (opacity == 0)
		{
			document.getElementById("pic" + id).style.display = "none";
			clearInterval(fadeOut);

			let fadeIn = setInterval(function()
			{
				opacity++;
				document.getElementById("pic" + newID).style.opacity = opacity + "%";
				document.getElementById("pic" + newID).style.display = "block";

				if (opacity == 100)
				{
					clearInterval(fadeIn);
					return;
				}
			}
			, 10)
		}
	}
	, 10);
}

function shutdown()
{
	sendData("shutdown");
}

function init()
{
	switchTab("home");
	document.getElementById("pic0").style.display = "block";
	document.getElementById("load").style.display = "none";
	getStats();
	getStatus();
	setInterval(getStatus, 30000);
	getRAM();
	openTerminalSocket();
	getServerPort();
}