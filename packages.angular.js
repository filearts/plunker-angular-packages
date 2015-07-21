var Boom = require("boom");
var Cornet = require("cornet");
var Fs = require("fs");
var Mongo = require("mongo-gyro");
var Parser = require("htmlparser2").WritableStream;
var Promise = require("bluebird");
var Request = require("request");
var Semver = require("semver");
var _ = require("lodash");

Promise.promisifyAll(Fs);

var mongo = new Mongo("mongodb://10.240.221.208,10.240.52.23/plunker");
  
function buildAngularPackageList () {
  
  var cornet = new Cornet();
  var parser = new Parser(cornet);
  
  var libs = [
    "angular-animate",
    "angular-aria",
    "angular-cookies",
    "angular-loader",
    "angular-messages",
    "angular-mocks",
    "angular-resource",
    "angular-route",
    "angular-sanitize",
    "angular-touch",
  ];
  
  var packages = {};
  
  var promises = [];
  
  var addPackageVersion = function (name, semver, dependencies, scripts, styles) {
    console.log("Adding package", name, semver);
    
    if (!packages[name]) {
      packages[name] = {
        name: name,
        versions: [],
      };
    }
    
    packages[name].versions.push({
      semver: semver,
      dependencies: dependencies || [],
      scripts: scripts || [],
      styles: styles || [],
      unstable: !!semver.match(/[-+]/),
    });
  };
  
  var checkRemoteFile = function (url) {
    return new Promise(function (resolve, reject) {
      Request.head({url: url}, function (err, resp, body) {
        if (err) return reject(err);
        
        if (resp.statusCode >= 200 && resp.statusCode < 300) return resolve(url);
        
        reject(Boom.notFound());
      });
    });
  };
  
  return new Promise(function (resolve, reject) {
    Request("https://code.angularjs.org")
      .on("error", function (err) {
        return reject(err);
      })
      .pipe(parser);
    
    cornet.select("a[href]", function (elem) {
      var semver = Semver.valid(elem.attribs.href.slice(0, -1));
      
      if (semver) {
        addPackageVersion("angular.js", semver, [], ["https://code.angularjs.org/" + semver +"/angular.js"], []);

        _.forEach(libs, function (lib) {
        
          promises.push(checkRemoteFile("https://code.angularjs.org/" + semver +"/" + lib + ".js")
            .then(function (url) {
              addPackageVersion(lib, semver, [{name: "angular.js", range: "~" + semver}], [url], []);
            }));
        });

      } else {
        console.log("Rejected", elem.attribs.href.slice(0, -1));
      }
    });
    
    cornet.on("dom", function () {
      var promise = Promise.settle(promises)
        .return(packages);
        
      return resolve(promise);
    });
  });
}

function savePackageList (packages) {
  return Fs.writeFileAsync("angular.packages.json", JSON.stringify(packages, null, 2), "utf8")
    .return(packages);
}

function updatePackageManager (packages) {

  return Promise.map(_.values(packages), function (pkgDef) {
    console.log(pkgDef.name, pkgDef.versions);
    //return pkgDef;
    return mongo.findAndModify("packages", {name: pkgDef.name}, {$set: {versions: pkgDef.versions}}, {new: true})
      .then(function (result) {
        console.log("mongo result", result);
      })
      .return(pkgDef, function (err) {
        console.log("ERR",err);
      });
  });
}

function readCachedPackageList () {
  console.log("Failed to read updated package list");
  
  return Fs.readFileAsync("angular.packages.json", "utf8")
    .then(JSON.parse.bind(JSON));
}


buildAngularPackageList()
  .then(savePackageList)
  .then(updatePackageManager)
  .then(function (packages) {
    console.log("Packages saved", packages.length);
  }, function (err) {
    console.log("ERROR", err);
  })
.then(function() {
//return mongo.find("plunks",{}).then(function(results){
//console.log("Results", results);
//})
})
  .finally(process.exit.bind(process, 0));
