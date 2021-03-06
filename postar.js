/**
* 
* - postAr -
* the beautifully simple post/paste tool
* NOW WITH PERSISTENCE! ^_^
* 
*/

var express = require('express');
var _ = require('underscore');
var moment = require('moment');
var fs = require('fs');
var persist = require('pst-obj');
var storage = {key:'', value:'', sticky:false, time:0};
//var storage = { key:"",value:"", };
var stats = require('./stats').create();
var postarPackage = require('./package.json');
var config = {
	"host":"127.0.0.1",
	"port":8888,
	"behindProxy": true,
	"customFooter": '',
	"maxCacheSize": 20,
	"maxDataSize": 102400, // 100kb
	"welcomeFooter": ''
};

try {
	config = _.extend(config, require('./config.json'));
} catch (err) {
	console.log('not loading custom config: ' + err);
}

var app = express();

var MAX_CACHE_SIZE = config.maxCacheSize;
var MAX_DATA_SIZE = config.maxDataSize; // 100kb
var TIMEFORMAT = "YYYY-MM-DD hh:mm:ss";

app.set('view engine', 'jade');

app.use('/static', express.static(__dirname + '/static'));

// expressjs doesn't support rawBody anymore by default, workaround:
app.use('/post', function(req, res, next) {
    var data = '';
    req.setEncoding('utf8');
    req.on('data', function(chunk) { 
    	if (req.tooLong) { return; }
        data += chunk;
        if (data.length > MAX_DATA_SIZE) {
        	data = data.substring(0, MAX_DATA_SIZE);
        	req.tooLong = true;
        }
    });
    req.on('end', function() {
        req.rawBody = data;
        next();
    });
});

//var storage = {};

function cleanup() {
	var values = _.values(storage);
	if (values.length < MAX_CACHE_SIZE) {
		return;
	}
	// sort (oldest last)
	var valuesByTime = _.sortBy(values, function(obj) { return -1 * obj.time; });
	for (var i=MAX_CACHE_SIZE; i<valuesByTime.length; i++) {
		var obj = valuesByTime[i];
		if (!obj.sticky) {
			console.log("cleaning up key " + obj.key);
			delete storage[obj.key];
		}
	}
}

persist.get('paste.json', storage, function(data, err) {
	storage = data;
	//values = _.values(storage);
	keyx = _.keys(storage);
	lenx = keyx.length - 4;
	//console.log("Paste.json " + (err ? 'created' : 'fetched') + ', latest key: ' + val.length);
	console.log("Paste.json " + (err ? 'created' : 'fetched') + ', latest key: ' + lenx + ' omg ');
});

/**
* @param sticky must only be set to true for internal/admin posts
*	sticky posts won't be garbage collected and cannot be overwritten
*/
function store(key, val, sticky) {
	sticky = sticky || false;
	if (!sticky) {
		// check if overwrite is allowed (current post doesn't exist or is non-sticky)
		var current = storage[key];
		if (current && current.sticky === true) {
			console.log("tried to overwrite sticky post, not allowed!");
			return false;
		}
	}
	storage[key] = {key:key, value:val, sticky:sticky, time:new Date().getTime()};
	storage.persist();
	//cleanup();
	return true;
}

function addGlobalViewData(viewObject) {
	viewObject.appVersion = postarPackage.version;
	return viewObject;
}

app.get('/', function(req, res) { res.redirect('/get/welcome'); });

app.get('/get/:id?', function(req, res) {
	var id = req.route.params["id"];
	if (!id || id.length < 1) {
		return res.redirect('/get/welcome');
	}
	var obj = storage[id];
	var viewObject = {host:req.host, key: id, post: obj, footer: config.customFooter};
	if (obj) {
		var dateTime = moment(obj.time).format(TIMEFORMAT);
		var timeAgo = moment(obj.time).fromNow();
		viewObject.timeString = "Posted " + timeAgo + " (" + dateTime +")";
		viewObject.value = obj.value;
		stats.onGet();
	}
	viewObject.randomKey = _.sample("abcdefghijklmnopqrstuvwxyz0123456789".split(""),5).join("");
	addGlobalViewData(viewObject);
	res.render('show', viewObject);
});

app.get('/post/:id', function(req, res) {
	return res.redirect('/get/' + req.route.params["id"]);
});

app.get('/stats', function(req, res) {
	var viewStats = stats.getStats();
	viewStats.since = moment(viewStats.since).format(TIMEFORMAT);
	res.render('stats', addGlobalViewData({stats: viewStats}));
});

app.post('/post/:id', function(req, res) {
	var id = req.route.params["id"];
	console.log("storing: " + req.rawBody);
	var ok = store(id, req.rawBody);
	if (!ok) {
		return res.send("ERR: cannot write to sticky post\n");
	}
	stats.onPost();
	if (req.tooLong === true) {
		return res.send("WARN: toolong\n");
	}
	return res.send("OK\n");
});

if (config.behindProxy) {
	// behind nginx
	app.enable('trust proxy');	
}

// read the info part of the readme file and use it as postAr's welcome text
fs.readFile('./README.md', 'utf8', function (err,data) {
  if (err) {
    return console.log(err);
  }
  var infoRegex = /<!--infostart-->([.\s\S]+)<!--infoend-->/;
  var match = infoRegex.exec(data);
  var infoText = "ERR, could not read README.md";
  if (match && match.length > 0) {
  	infoText = match[1];
  }
  store('welcome', 'Welcome to postAr!\n' + infoText + config.welcomeFooter, true);

  // start postAr
  app.listen(config.port, config.host);
});