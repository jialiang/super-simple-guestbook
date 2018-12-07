var http = require("turbo-http");
var https = require("https");
var qs = require("querystring");
var fs = require("fs");
var loki = require("lokijs");
var cloudinary = require("cloudinary");

cloudinary.config({
    cloud_name: "hm6jonksx",
    api_key: "",
    api_secret: ""
});

var dbChanged = false;

var db = new loki("loki.json");
var mainCollection = db.addCollection("main");

var ip, today;
var req, res, path = "";

//////////

setInterval(function() {
    console.log("Scheduled tasks started.");

    if (dbChanged) {
        backupDB();
        dbChanged = false;
    }

    https.request({
        host: "guestbook-1.herokuapp.com",
        port: 443,
        path: "/",
        method: "GET"
    }).end();
}, 1000 * 60 * 10);

initDB();

//////////

function initDB() {
    restoreDB(initServer);
}

function initServer() {
    console.log("Server started");

    http.createServer(function(request, response) {
        req = request;
        res = response;

        if (req.method === "OPTIONS" || req.url === "/") return end({ statusCode: 200, message: "OK" });
        if (["GET", "POST", "DELETE"].indexOf(req.method) === -1) return end(405);

        if (req.url.split("?")[0] === "/entries") path = "entries";
        if (req.url === "/admin-KEY") path = "admin";

        if (path === "") return end(404);

        ip = req.getHeader("x-forwarded-for") || "0.0.0.0";
        today = (new Date()).toLocaleDateString();

        if (req.method === "GET") {
            router();
        } else {
            request.ondata = parseBody;
        }
    }).listen(process.env.PORT || 8080);
}

//////////

function end(input) {
    var messages = {
        404: "Requested resource not found,",
        405: "Request method not supported.",
        413: "Request body too large."
    }

    var results = input;

    if (typeof input === "string") results = {
        statusCode: 500,
        message: input
    }

    if (typeof input === "number") results = {
        statusCode: input || 500,
        message: messages[input] || "An error occured while processing the request"
    };

    res.statusCode = results.statusCode;
    res.setHeader("Access-Control-Allow-Origin", "https://jialiang.github.io");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(results));
}

function parseBody(buffer, start, length) {
    if (length > 10000) return end(413);

    var obj, str = buffer.slice(start, start + length).toString("utf8");

    try {
        obj = JSON.parse(str);
        router(obj);
    } catch (exception) {
        end({
            statusCode: 400,
            message: exception
        });
    }
}

function router(body) {
    if (path === "entries") entries(body);
    if (path === "admin") admin(body);
}

//////////

function uploadToCloudinary(obj) {
    var filename = obj.filename;
    var data = obj.data;

    return new Promise(function(resolve, reject) {
        cloudinary.v2.uploader.upload_stream({
            public_id: filename,
            overwrite: true,
            resource_type: "raw",
            invalidate: true
        }, function(error, result) {
            if (error) return reject(JSON.stringify(error));
            resolve("Uploaded " + filename + " to Cloudinary");
        }).end(data);
    });
}

function getFromCloudinary(obj) {
    var filename = obj.filename;
    var version = obj.version;

    return new Promise(function(resolve, reject) {
        https.request({
            host: "res.cloudinary.com",
            port: 443,
            path: "/hm6jonksx/raw/upload/v" + version + "/" + filename,
            method: "GET"
        }, function(response, error) {
            if (error) return reject(error);

            var body = "";

            response.on("data", function(data) { body += data; });
            response.on("end", function() {
                resolve({
                    filename: filename,
                    data: body
                });
            });
            response.on("error", function(error) { reject(error); });
        }).end();
    });
}

function getLatestVersion(filename) {
    return new Promise(function(resolve, reject) {
        https.request({
            host: "api.cloudinary.com",
            port: 443,
            path: "/v1_1/hm6jonksx/resources/raw?public_ids=" + filename,
            method: "GET",
            headers: {
                "Authorization": "Basic " + new Buffer("").toString("base64")
            }
        }, function(response, error) {
            if (error) return reject(error);

            var body = "";

            response.on("data", function(data) { body += data; });
            response.on("end", function() {
                var obj = JSON.parse(body);

                if (obj.resources.length === 0) return reject("Missing: " + filename);

                resolve({
                    filename: filename,
                    version: obj.resources[0].version
                });
            });
            response.on("error", function(error) { reject(error); });
        }).end();
    });
}

function readFile(filename) {
    return new Promise(function(resolve, reject) {
        fs.readFile(filename, function read(error, data) {
            if (error) return reject(error);
            resolve({
                filename: filename,
                data: data
            });
        });
    });
}

function writeFile(obj) {
    var filename = obj.filename;
    var data = obj.data;

    return new Promise(function(resolve, reject) {
        fs.writeFile(filename, data, function(error) {
            if (error) return reject(error);
            resolve("Wrote " + filename + " to disk.");
        });
    });
}

//////////

function restoreDB(callback) {
    var data = getLatestVersion("loki.json").then(getFromCloudinary).then(writeFile).then(console.log);

    Promise.all([data]).then(function() {
        console.log("Restore DB success");

        db.loadDatabase({}, function(error) {
            if (error) return console.log(error);

            mainCollection = db.getCollection("main");
            callback();
        });
    }).catch(function(error) {
        if (error.indexOf("Missing:") === 0) return db.saveDatabase(function(error) {
            if (error) return console.log("Save database failed: " + error);

            callback();
        });

        console.log("Restore DB failed: " + error);
    });
}

function backupDB() {
    db.saveDatabase(function(error) {
        if (error) return console.log("Save database failed: " + error);

        var data = readFile("loki.json").then(uploadToCloudinary).then(console.log);

        Promise.all([data]).then(function() {
            console.log("Backup DB success");
        }).catch(function(error) {
            console.log("Backup DB error: " + error);
        });
    });
}

//////////

function admin(body) {
    if (req.method === "POST") {
        mainCollection.data = body.data;

        dbChanged = true;

        end({
            statusCode: 200,
            message: "Operation completed"
        });
    }

    if (req.method === "GET") end({
        statusCode: 200,
        data: mainCollection.data
    });
}

function entries(body) {
    if (req.method === "GET") {
        var results = {
            statusCode: 200,
            message: "Retrieve success.",
            results: []
        }

        var yourEntry = mainCollection.findOne({
            ip: ip,
            date: today
        });

        if (yourEntry) results.yourEntry = {
            date: yourEntry.date,
            name: yourEntry.name,
            message: yourEntry.message,
            website: yourEntry.website
        };

        var page = (qs.parse(req.url.split("?")[1])).page;
        var entriesToShow = (parseInt(page) || 0) * 10;
        var allEntries = mainCollection.find({});

        for (var i = allEntries.length - 1; i >= entriesToShow; i--) {
            results.results.push({
                date: allEntries[i].date,
                name: allEntries[i].name,
                message: allEntries[i].message,
                website: allEntries[i].website
            });
        }

        end(results);
    }

    if (req.method === "POST") {
        var name = body.name ? body.name.trim() : null;
        var message = body.message ? body.message.trim() : null;
        var website = body.website ? body.website.trim() : "";

        if (!name || !message) return end({
            statusCode: 400,
            message: "Required parameter(s) missing."
        });

        dbChanged = true;

        var yourEntry = mainCollection.findOne({
            ip: ip,
            date: today
        });

        if (!yourEntry) {
            mainCollection.insert({
                ip: ip,
                date: today,
                name: name,
                message: message,
                website: website
            });

            end({
                statusCode: 200,
                message: "Entry inserted."
            });
        } else {
            yourEntry.name = name;
            yourEntry.message = message;
            yourEntry.website = website;

            mainCollection.update(yourEntry);

            end({
                statusCode: 200,
                message: "Entry updated."
            });
        }
    }

    if (req.method === "DELETE") {
        var yourEntry = mainCollection.findOne({
            ip: ip,
            date: today
        });

        if (!yourEntry) {
            end({
                statusCode: 400,
                message: "Entry not found."
            });
        } else {
            mainCollection.remove(yourEntry);
            end({
                statusCode: 200,
                message: "Entry deleted."
            });
        }
    }
}