
var Module;

if (typeof Module === 'undefined') Module = eval('(function() { try { return Module || {} } catch(e) { return {} } })()');

if (!Module.expectedDataFileDownloads) {
  Module.expectedDataFileDownloads = 0;
  Module.finishedDataFileDownloads = 0;
}
Module.expectedDataFileDownloads++;
(function() {
 var loadPackage = function(metadata) {

  var PACKAGE_PATH;
  if (typeof window === 'object') {
    PACKAGE_PATH = window['encodeURIComponent'](window.location.pathname.toString().substring(0, window.location.pathname.toString().lastIndexOf('/')) + '/');
  } else if (typeof location !== 'undefined') {
      // worker
      PACKAGE_PATH = encodeURIComponent(location.pathname.toString().substring(0, location.pathname.toString().lastIndexOf('/')) + '/');
    } else {
      throw 'using preloaded data can only be done on a web page or in a web worker';
    }
    var PACKAGE_NAME = 'game.data';
    var REMOTE_PACKAGE_BASE = 'game.data';
    if (typeof Module['locateFilePackage'] === 'function' && !Module['locateFile']) {
      Module['locateFile'] = Module['locateFilePackage'];
      Module.printErr('warning: you defined Module.locateFilePackage, that has been renamed to Module.locateFile (using your locateFilePackage for now)');
    }
    var REMOTE_PACKAGE_NAME = typeof Module['locateFile'] === 'function' ?
    Module['locateFile'](REMOTE_PACKAGE_BASE) :
    ((Module['filePackagePrefixURL'] || '') + REMOTE_PACKAGE_BASE);

    var REMOTE_PACKAGE_SIZE = metadata.remote_package_size;
    var PACKAGE_UUID = metadata.package_uuid;

    function fetchRemotePackage(packageName, packageSize, callback, errback) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', packageName, true);
      xhr.responseType = 'arraybuffer';
      xhr.onprogress = function(event) {
        var url = packageName;
        var size = packageSize;
        if (event.total) size = event.total;
        if (event.loaded) {
          if (!xhr.addedTotal) {
            xhr.addedTotal = true;
            if (!Module.dataFileDownloads) Module.dataFileDownloads = {};
            Module.dataFileDownloads[url] = {
              loaded: event.loaded,
              total: size
            };
          } else {
            Module.dataFileDownloads[url].loaded = event.loaded;
          }
          var total = 0;
          var loaded = 0;
          var num = 0;
          for (var download in Module.dataFileDownloads) {
            var data = Module.dataFileDownloads[download];
            total += data.total;
            loaded += data.loaded;
            num++;
          }
          total = Math.ceil(total * Module.expectedDataFileDownloads/num);
          if (Module['setStatus']) Module['setStatus']('Downloading data... (' + loaded + '/' + total + ')');
        } else if (!Module.dataFileDownloads) {
          if (Module['setStatus']) Module['setStatus']('Downloading data...');
        }
      };
      xhr.onerror = function(event) {
        throw new Error("NetworkError for: " + packageName);
      }
      xhr.onload = function(event) {
        if (xhr.status == 200 || xhr.status == 304 || xhr.status == 206 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
          var packageData = xhr.response;
          callback(packageData);
        } else {
          throw new Error(xhr.statusText + " : " + xhr.responseURL);
        }
      };
      xhr.send(null);
    };

    function handleError(error) {
      console.error('package error:', error);
    };

    function runWithFS() {

      function assert(check, msg) {
        if (!check) throw msg + new Error().stack;
      }
      Module['FS_createPath']('/', 'images', true, true);
      Module['FS_createPath']('/', 'levels', true, true);
      Module['FS_createPath']('/', 'maps', true, true);
      Module['FS_createPath']('/', 'music', true, true);
      Module['FS_createPath']('/', 'objects', true, true);
      Module['FS_createPath']('/', 'rooms', true, true);
      Module['FS_createPath']('/', 'songs', true, true);
      Module['FS_createPath']('/songs', 'menu', true, true);
      Module['FS_createPath']('/', 'sounds', true, true);

      function DataRequest(start, end, crunched, audio) {
        this.start = start;
        this.end = end;
        this.crunched = crunched;
        this.audio = audio;
      }
      DataRequest.prototype = {
        requests: {},
        open: function(mode, name) {
          this.name = name;
          this.requests[name] = this;
          Module['addRunDependency']('fp ' + this.name);
        },
        send: function() {},
        onload: function() {
          var byteArray = this.byteArray.subarray(this.start, this.end);

          this.finish(byteArray);

        },
        finish: function(byteArray) {
          var that = this;

        Module['FS_createDataFile'](this.name, null, byteArray, true, true, true); // canOwn this data in the filesystem, it is a slide into the heap that will never change
        Module['removeRunDependency']('fp ' + that.name);

        this.requests[this.name] = null;
      }
    };

    var files = metadata.files;
    for (i = 0; i < files.length; ++i) {
      new DataRequest(files[i].start, files[i].end, files[i].crunched, files[i].audio).open('GET', files[i].filename);
    }


    var indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
    var IDB_RO = "readonly";
    var IDB_RW = "readwrite";
    var DB_NAME = "EM_PRELOAD_CACHE";
    var DB_VERSION = 1;
    var METADATA_STORE_NAME = 'METADATA';
    var PACKAGE_STORE_NAME = 'PACKAGES';
    function openDatabase(callback, errback) {
      try {
        var openRequest = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        return errback(e);
      }
      openRequest.onupgradeneeded = function(event) {
        var db = event.target.result;

        if(db.objectStoreNames.contains(PACKAGE_STORE_NAME)) {
          db.deleteObjectStore(PACKAGE_STORE_NAME);
        }
        var packages = db.createObjectStore(PACKAGE_STORE_NAME);

        if(db.objectStoreNames.contains(METADATA_STORE_NAME)) {
          db.deleteObjectStore(METADATA_STORE_NAME);
        }
        var metadata = db.createObjectStore(METADATA_STORE_NAME);
      };
      openRequest.onsuccess = function(event) {
        var db = event.target.result;
        callback(db);
      };
      openRequest.onerror = function(error) {
        errback(error);
      };
    };

    /* Check if there's a cached package, and if so whether it's the latest available */
    function checkCachedPackage(db, packageName, callback, errback) {
      var transaction = db.transaction([METADATA_STORE_NAME], IDB_RO);
      var metadata = transaction.objectStore(METADATA_STORE_NAME);

      var getRequest = metadata.get("metadata/" + packageName);
      getRequest.onsuccess = function(event) {
        var result = event.target.result;
        if (!result) {
          return callback(false);
        } else {
          return callback(PACKAGE_UUID === result.uuid);
        }
      };
      getRequest.onerror = function(error) {
        errback(error);
      };
    };

    function fetchCachedPackage(db, packageName, callback, errback) {
      var transaction = db.transaction([PACKAGE_STORE_NAME], IDB_RO);
      var packages = transaction.objectStore(PACKAGE_STORE_NAME);

      var getRequest = packages.get("package/" + packageName);
      getRequest.onsuccess = function(event) {
        var result = event.target.result;
        callback(result);
      };
      getRequest.onerror = function(error) {
        errback(error);
      };
    };

    function cacheRemotePackage(db, packageName, packageData, packageMeta, callback, errback) {
      var transaction_packages = db.transaction([PACKAGE_STORE_NAME], IDB_RW);
      var packages = transaction_packages.objectStore(PACKAGE_STORE_NAME);

      var putPackageRequest = packages.put(packageData, "package/" + packageName);
      putPackageRequest.onsuccess = function(event) {
        var transaction_metadata = db.transaction([METADATA_STORE_NAME], IDB_RW);
        var metadata = transaction_metadata.objectStore(METADATA_STORE_NAME);
        var putMetadataRequest = metadata.put(packageMeta, "metadata/" + packageName);
        putMetadataRequest.onsuccess = function(event) {
          callback(packageData);
        };
        putMetadataRequest.onerror = function(error) {
          errback(error);
        };
      };
      putPackageRequest.onerror = function(error) {
        errback(error);
      };
    };

    function processPackageData(arrayBuffer) {
      Module.finishedDataFileDownloads++;
      assert(arrayBuffer, 'Loading data file failed.');
      assert(arrayBuffer instanceof ArrayBuffer, 'bad input to processPackageData');
      var byteArray = new Uint8Array(arrayBuffer);
      var curr;

        // copy the entire loaded file into a spot in the heap. Files will refer to slices in that. They cannot be freed though
        // (we may be allocating before malloc is ready, during startup).
        if (Module['SPLIT_MEMORY']) Module.printErr('warning: you should run the file packager with --no-heap-copy when SPLIT_MEMORY is used, otherwise copying into the heap may fail due to the splitting');
        var ptr = Module['getMemory'](byteArray.length);
        Module['HEAPU8'].set(byteArray, ptr);
        DataRequest.prototype.byteArray = Module['HEAPU8'].subarray(ptr, ptr+byteArray.length);

        var files = metadata.files;
        for (i = 0; i < files.length; ++i) {
          DataRequest.prototype.requests[files[i].filename].onload();
        }
        Module['removeRunDependency']('datafile_game.data');

      };
      Module['addRunDependency']('datafile_game.data');

      if (!Module.preloadResults) Module.preloadResults = {};

      function preloadFallback(error) {
        console.error(error);
        console.error('falling back to default preload behavior');
        fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE, processPackageData, handleError);
      };

      openDatabase(
        function(db) {
          checkCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME,
            function(useCached) {
              Module.preloadResults[PACKAGE_NAME] = {fromCache: useCached};
              if (useCached) {
                console.info('loading ' + PACKAGE_NAME + ' from cache');
                fetchCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME, processPackageData, preloadFallback);
              } else {
                console.info('loading ' + PACKAGE_NAME + ' from remote');
                fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE,
                  function(packageData) {
                    cacheRemotePackage(db, PACKAGE_PATH + PACKAGE_NAME, packageData, {uuid:PACKAGE_UUID}, processPackageData,
                      function(error) {
                        console.error(error);
                        processPackageData(packageData);
                      });
                  }
                  , preloadFallback);
              }
            }
            , preloadFallback);
        }
        , preloadFallback);

      if (Module['setStatus']) Module['setStatus']('Downloading...');

    }
    if (Module['calledRun']) {
      runWithFS();
    } else {
      if (!Module['preRun']) Module['preRun'] = [];
      Module["preRun"].push(runWithFS); // FS is not initialized yet, wait for it
    }

  }
  loadPackage({"package_uuid":"dbfdaf64-e674-4bcd-954a-3a8af0c16c38","remote_package_size":20983778,"files":[{"filename":"/colors.lua","crunched":0,"start":0,"end":876,"audio":false},{"filename":"/conf.lua","crunched":0,"start":876,"end":1491,"audio":false},{"filename":"/config.lua","crunched":0,"start":1491,"end":2794,"audio":false},{"filename":"/editscript.lua","crunched":0,"start":2794,"end":9471,"audio":false},{"filename":"/font.lua","crunched":0,"start":9471,"end":9612,"audio":false},{"filename":"/icon.ico","crunched":0,"start":9612,"end":9874,"audio":false},{"filename":"/icon.png","crunched":0,"start":9874,"end":10065,"audio":false},{"filename":"/icon512.png","crunched":0,"start":10065,"end":10361,"audio":false},{"filename":"/images/_89deg.png","crunched":0,"start":10361,"end":10849,"audio":false},{"filename":"/images/act1.png","crunched":0,"start":10849,"end":11161,"audio":false},{"filename":"/images/act2.png","crunched":0,"start":11161,"end":11985,"audio":false},{"filename":"/images/act3.png","crunched":0,"start":11985,"end":12815,"audio":false},{"filename":"/images/beta.png","crunched":0,"start":12815,"end":13065,"audio":false},{"filename":"/images/card.png","crunched":0,"start":13065,"end":13525,"audio":false},{"filename":"/images/card1.png","crunched":0,"start":13525,"end":13731,"audio":false},{"filename":"/images/card10.png","crunched":0,"start":13731,"end":14032,"audio":false},{"filename":"/images/card11.png","crunched":0,"start":14032,"end":14325,"audio":false},{"filename":"/images/card12.png","crunched":0,"start":14325,"end":14537,"audio":false},{"filename":"/images/card13.png","crunched":0,"start":14537,"end":14816,"audio":false},{"filename":"/images/card14.png","crunched":0,"start":14816,"end":15102,"audio":false},{"filename":"/images/card15.png","crunched":0,"start":15102,"end":15383,"audio":false},{"filename":"/images/card16.png","crunched":0,"start":15383,"end":15774,"audio":false},{"filename":"/images/card17.png","crunched":0,"start":15774,"end":15990,"audio":false},{"filename":"/images/card18.png","crunched":0,"start":15990,"end":16255,"audio":false},{"filename":"/images/card19.png","crunched":0,"start":16255,"end":16536,"audio":false},{"filename":"/images/card2.png","crunched":0,"start":16536,"end":16759,"audio":false},{"filename":"/images/card20.png","crunched":0,"start":16759,"end":17039,"audio":false},{"filename":"/images/card21.png","crunched":0,"start":17039,"end":17488,"audio":false},{"filename":"/images/card22.png","crunched":0,"start":17488,"end":17750,"audio":false},{"filename":"/images/card23.png","crunched":0,"start":17750,"end":18041,"audio":false},{"filename":"/images/card24.png","crunched":0,"start":18041,"end":18309,"audio":false},{"filename":"/images/card25.png","crunched":0,"start":18309,"end":18636,"audio":false},{"filename":"/images/card26.png","crunched":0,"start":18636,"end":19078,"audio":false},{"filename":"/images/card27.png","crunched":0,"start":19078,"end":19304,"audio":false},{"filename":"/images/card28.png","crunched":0,"start":19304,"end":19593,"audio":false},{"filename":"/images/card29.png","crunched":0,"start":19593,"end":19884,"audio":false},{"filename":"/images/card3.png","crunched":0,"start":19884,"end":20096,"audio":false},{"filename":"/images/card30.png","crunched":0,"start":20096,"end":20392,"audio":false},{"filename":"/images/card31.png","crunched":0,"start":20392,"end":20804,"audio":false},{"filename":"/images/card32.png","crunched":0,"start":20804,"end":21265,"audio":false},{"filename":"/images/card33.png","crunched":0,"start":21265,"end":21662,"audio":false},{"filename":"/images/card34.png","crunched":0,"start":21662,"end":21853,"audio":false},{"filename":"/images/card35.png","crunched":0,"start":21853,"end":22726,"audio":false},{"filename":"/images/card4.png","crunched":0,"start":22726,"end":22954,"audio":false},{"filename":"/images/card5.png","crunched":0,"start":22954,"end":23205,"audio":false},{"filename":"/images/card6.png","crunched":0,"start":23205,"end":23463,"audio":false},{"filename":"/images/card7.png","crunched":0,"start":23463,"end":23731,"audio":false},{"filename":"/images/card8.png","crunched":0,"start":23731,"end":24050,"audio":false},{"filename":"/images/card9.png","crunched":0,"start":24050,"end":24329,"audio":false},{"filename":"/images/cardna.png","crunched":0,"start":24329,"end":24719,"audio":false},{"filename":"/images/checkbox.png","crunched":0,"start":24719,"end":24908,"audio":false},{"filename":"/images/coconut.jpg","crunched":0,"start":24908,"end":65564,"audio":false},{"filename":"/images/comingnever.png","crunched":0,"start":65564,"end":66765,"audio":false},{"filename":"/images/cursor.png","crunched":0,"start":66765,"end":66962,"audio":false},{"filename":"/images/delete.png","crunched":0,"start":66962,"end":67170,"audio":false},{"filename":"/images/demo.png","crunched":0,"start":67170,"end":67409,"audio":false},{"filename":"/images/font.png","crunched":0,"start":67409,"end":68230,"audio":false},{"filename":"/images/le_boost.png","crunched":0,"start":68230,"end":68647,"audio":false},{"filename":"/images/le_camera.png","crunched":0,"start":68647,"end":68822,"audio":false},{"filename":"/images/le_checkpoint.png","crunched":0,"start":68822,"end":69116,"audio":false},{"filename":"/images/le_cmd.png","crunched":0,"start":69116,"end":69272,"audio":false},{"filename":"/images/le_falling.png","crunched":0,"start":69272,"end":69423,"audio":false},{"filename":"/images/le_falling0.png","crunched":0,"start":69423,"end":69599,"audio":false},{"filename":"/images/le_falling1.png","crunched":0,"start":69599,"end":69750,"audio":false},{"filename":"/images/le_falling2.png","crunched":0,"start":69750,"end":69901,"audio":false},{"filename":"/images/le_fragment.png","crunched":0,"start":69901,"end":70187,"audio":false},{"filename":"/images/le_gravity.png","crunched":0,"start":70187,"end":70409,"audio":false},{"filename":"/images/le_ice.png","crunched":0,"start":70409,"end":70556,"audio":false},{"filename":"/images/le_lava.png","crunched":0,"start":70556,"end":70703,"audio":false},{"filename":"/images/le_moving.png","crunched":0,"start":70703,"end":70866,"audio":false},{"filename":"/images/le_music.png","crunched":0,"start":70866,"end":71026,"audio":false},{"filename":"/images/le_point.png","crunched":0,"start":71026,"end":71204,"audio":false},{"filename":"/images/le_semisolid.png","crunched":0,"start":71204,"end":71351,"audio":false},{"filename":"/images/le_solid.png","crunched":0,"start":71351,"end":71498,"audio":false},{"filename":"/images/le_spring.png","crunched":0,"start":71498,"end":71655,"audio":false},{"filename":"/images/le_text.png","crunched":0,"start":71655,"end":71816,"audio":false},{"filename":"/images/le_trophy.png","crunched":0,"start":71816,"end":71988,"audio":false},{"filename":"/images/le_water.png","crunched":0,"start":71988,"end":72205,"audio":false},{"filename":"/images/le_you.png","crunched":0,"start":72205,"end":72376,"audio":false},{"filename":"/images/le_zone.png","crunched":0,"start":72376,"end":72534,"audio":false},{"filename":"/images/lite.png","crunched":0,"start":72534,"end":72764,"audio":false},{"filename":"/images/lockedcard.png","crunched":0,"start":72764,"end":73639,"audio":false},{"filename":"/images/logo2.png","crunched":0,"start":73639,"end":74118,"audio":false},{"filename":"/images/loss.jpg","crunched":0,"start":74118,"end":79349,"audio":false},{"filename":"/images/love.png","crunched":0,"start":79349,"end":84007,"audio":false},{"filename":"/images/lovepixel.png","crunched":0,"start":84007,"end":84622,"audio":false},{"filename":"/images/pan.png","crunched":0,"start":84622,"end":84824,"audio":false},{"filename":"/images/point.png","crunched":0,"start":84824,"end":85004,"audio":false},{"filename":"/images/preview1-1.png","crunched":0,"start":85004,"end":85214,"audio":false},{"filename":"/images/search.png","crunched":0,"start":85214,"end":85419,"audio":false},{"filename":"/images/small.png","crunched":0,"start":85419,"end":86617,"audio":false},{"filename":"/images/sooncard.png","crunched":0,"start":86617,"end":87690,"audio":false},{"filename":"/images/trophy.png","crunched":0,"start":87690,"end":87876,"audio":false},{"filename":"/images.lua","crunched":0,"start":87876,"end":87885,"audio":false},{"filename":"/levels/act1.lvl","crunched":0,"start":87885,"end":88228,"audio":false},{"filename":"/levels/ph-a.lvl","crunched":0,"start":88228,"end":90259,"audio":false},{"filename":"/levels/techdemo.lvl","crunched":0,"start":90259,"end":115584,"audio":false},{"filename":"/levels/thesillylevelpack.lvl","crunched":0,"start":115584,"end":122753,"audio":false},{"filename":"/levelscript.lua","crunched":0,"start":122753,"end":131084,"audio":false},{"filename":"/main.lua","crunched":0,"start":131084,"end":166783,"audio":false},{"filename":"/maps/act1.map","crunched":0,"start":166783,"end":167008,"audio":false},{"filename":"/maps/phys.map","crunched":0,"start":167008,"end":167268,"audio":false},{"filename":"/maps/techdemo.map","crunched":0,"start":167268,"end":168698,"audio":false},{"filename":"/mapscript.lua","crunched":0,"start":168698,"end":176660,"audio":false},{"filename":"/music/bigwin.wav","crunched":0,"start":176660,"end":1234612,"audio":true},{"filename":"/music/booowaa.ogg","crunched":0,"start":1234612,"end":1562221,"audio":true},{"filename":"/music/breath.ogg","crunched":0,"start":1562221,"end":1770155,"audio":true},{"filename":"/music/finalemusic.ogg","crunched":0,"start":1770155,"end":3317971,"audio":true},{"filename":"/music/finalemusicintro.ogg","crunched":0,"start":3317971,"end":3370698,"audio":true},{"filename":"/music/flipped.ogg","crunched":0,"start":3370698,"end":3690245,"audio":true},{"filename":"/music/getready.ogg","crunched":0,"start":3690245,"end":3945253,"audio":true},{"filename":"/music/helpimdrowning.ogg","crunched":0,"start":3945253,"end":4279920,"audio":true},{"filename":"/music/icanseemyhousefromhere.ogg","crunched":0,"start":4279920,"end":4545302,"audio":true},{"filename":"/music/learn.ogg","crunched":0,"start":4545302,"end":4794168,"audio":true},{"filename":"/music/lvl1.ogg","crunched":0,"start":4794168,"end":4873209,"audio":true},{"filename":"/music/lvl2.ogg","crunched":0,"start":4873209,"end":5053495,"audio":true},{"filename":"/music/lvl3.ogg","crunched":0,"start":5053495,"end":5313319,"audio":true},{"filename":"/music/lvl4.ogg","crunched":0,"start":5313319,"end":5648115,"audio":true},{"filename":"/music/lvl5.ogg","crunched":0,"start":5648115,"end":5978146,"audio":true},{"filename":"/music/lvl6.ogg","crunched":0,"start":5978146,"end":6282214,"audio":true},{"filename":"/music/lvl78.ogg","crunched":0,"start":6282214,"end":6602472,"audio":true},{"filename":"/music/menu.mp3","crunched":0,"start":6602472,"end":7030485,"audio":true},{"filename":"/music/menu1.mp3","crunched":0,"start":7030485,"end":7738434,"audio":true},{"filename":"/music/menu2.mp3","crunched":0,"start":7738434,"end":8671177,"audio":true},{"filename":"/music/menu3.mp3","crunched":0,"start":8671177,"end":9470723,"audio":true},{"filename":"/music/menu4.mp3","crunched":0,"start":9470723,"end":10272467,"audio":true},{"filename":"/music/menu5.mp3","crunched":0,"start":10272467,"end":11116330,"audio":true},{"filename":"/music/purple.ogg","crunched":0,"start":11116330,"end":11450846,"audio":true},{"filename":"/music/slippery.ogg","crunched":0,"start":11450846,"end":11784933,"audio":true},{"filename":"/music/think.ogg","crunched":0,"start":11784933,"end":12038680,"audio":true},{"filename":"/music/win.wav","crunched":0,"start":12038680,"end":12567224,"audio":true},{"filename":"/music.lua","crunched":0,"start":12567224,"end":12575639,"audio":false},{"filename":"/objects/boostorb.lua","crunched":0,"start":12575639,"end":12578231,"audio":false},{"filename":"/objects/bouncepad.lua","crunched":0,"start":12578231,"end":12581014,"audio":false},{"filename":"/objects/button.lua","crunched":0,"start":12581014,"end":12585647,"audio":false},{"filename":"/objects/cameratrigger.lua","crunched":0,"start":12585647,"end":12586253,"audio":false},{"filename":"/objects/checkpoint.lua","crunched":0,"start":12586253,"end":12588281,"audio":false},{"filename":"/objects/checkpointbutton.lua","crunched":0,"start":12588281,"end":12592961,"audio":false},{"filename":"/objects/dialog.lua","crunched":0,"start":12592961,"end":12594889,"audio":false},{"filename":"/objects/dragable.lua","crunched":0,"start":12594889,"end":12596520,"audio":false},{"filename":"/objects/editablelevel.lua","crunched":0,"start":12596520,"end":12624356,"audio":false},{"filename":"/objects/explosiveparticles.lua","crunched":0,"start":12624356,"end":12625927,"audio":false},{"filename":"/objects/falling.lua","crunched":0,"start":12625927,"end":12630312,"audio":false},{"filename":"/objects/fragment.lua","crunched":0,"start":12630312,"end":12633407,"audio":false},{"filename":"/objects/gravity.lua","crunched":0,"start":12633407,"end":12636796,"audio":false},{"filename":"/objects/group.lua","crunched":0,"start":12636796,"end":12640088,"audio":false},{"filename":"/objects/image.lua","crunched":0,"start":12640088,"end":12640605,"audio":false},{"filename":"/objects/input.lua","crunched":0,"start":12640605,"end":12644162,"audio":false},{"filename":"/objects/lava.lua","crunched":0,"start":12644162,"end":12646277,"audio":false},{"filename":"/objects/level.lua","crunched":0,"start":12646277,"end":12653529,"audio":false},{"filename":"/objects/line.lua","crunched":0,"start":12653529,"end":12654154,"audio":false},{"filename":"/objects/mapimage.lua","crunched":0,"start":12654154,"end":12655099,"audio":false},{"filename":"/objects/moving.lua","crunched":0,"start":12655099,"end":12658712,"audio":false},{"filename":"/objects/musiczone.lua","crunched":0,"start":12658712,"end":12659310,"audio":false},{"filename":"/objects/option.lua","crunched":0,"start":12659310,"end":12664843,"audio":false},{"filename":"/objects/pausemenu.lua","crunched":0,"start":12664843,"end":12675127,"audio":false},{"filename":"/objects/player.lua","crunched":0,"start":12675127,"end":12717956,"audio":false},{"filename":"/objects/point.lua","crunched":0,"start":12717956,"end":12718402,"audio":false},{"filename":"/objects/screenanim.lua","crunched":0,"start":12718402,"end":12719781,"audio":false},{"filename":"/objects/scrollable.lua","crunched":0,"start":12719781,"end":12720591,"audio":false},{"filename":"/objects/scrollingbackground.lua","crunched":0,"start":12720591,"end":12721465,"audio":false},{"filename":"/objects/semisolid.lua","crunched":0,"start":12721465,"end":12722267,"audio":false},{"filename":"/objects/slider.lua","crunched":0,"start":12722267,"end":12726426,"audio":false},{"filename":"/objects/solid.lua","crunched":0,"start":12726426,"end":12727377,"audio":false},{"filename":"/objects/solidbackground.lua","crunched":0,"start":12727377,"end":12727718,"audio":false},{"filename":"/objects/text.lua","crunched":0,"start":12727718,"end":12729095,"audio":false},{"filename":"/objects/trigger.lua","crunched":0,"start":12729095,"end":12729834,"audio":false},{"filename":"/objects/trophy.lua","crunched":0,"start":12729834,"end":12732576,"audio":false},{"filename":"/objects/water.lua","crunched":0,"start":12732576,"end":12734434,"audio":false},{"filename":"/objects/winscreen.lua","crunched":0,"start":12734434,"end":12737725,"audio":false},{"filename":"/objects/zone.lua","crunched":0,"start":12737725,"end":12738247,"audio":false},{"filename":"/rooms/404.lua","crunched":0,"start":12738247,"end":12739161,"audio":false},{"filename":"/rooms/about.lua","crunched":0,"start":12739161,"end":12740511,"audio":false},{"filename":"/rooms/actselect.lua","crunched":0,"start":12740511,"end":12745791,"audio":false},{"filename":"/rooms/background.lua","crunched":0,"start":12745791,"end":12746559,"audio":false},{"filename":"/rooms/colortest.lua","crunched":0,"start":12746559,"end":12747683,"audio":false},{"filename":"/rooms/controls.lua","crunched":0,"start":12747683,"end":12753273,"audio":false},{"filename":"/rooms/editor.lua","crunched":0,"start":12753273,"end":12770137,"audio":false},{"filename":"/rooms/level.lua","crunched":0,"start":12770137,"end":12771953,"audio":false},{"filename":"/rooms/levelselect.lua","crunched":0,"start":12771953,"end":12774190,"audio":false},{"filename":"/rooms/load.lua","crunched":0,"start":12774190,"end":12780954,"audio":false},{"filename":"/rooms/loading.lua","crunched":0,"start":12780954,"end":12781209,"audio":false},{"filename":"/rooms/mainmenu.lua","crunched":0,"start":12781209,"end":12784643,"audio":false},{"filename":"/rooms/other.lua","crunched":0,"start":12784643,"end":12787329,"audio":false},{"filename":"/rooms/pls.lua","crunched":0,"start":12787329,"end":12788810,"audio":false},{"filename":"/rooms/settings.lua","crunched":0,"start":12788810,"end":12791746,"audio":false},{"filename":"/rooms/title.lua","crunched":0,"start":12791746,"end":12797624,"audio":false},{"filename":"/rooms/visuals.lua","crunched":0,"start":12797624,"end":12799924,"audio":false},{"filename":"/run.lua","crunched":0,"start":12799924,"end":12801277,"audio":false},{"filename":"/smallfont.lua","crunched":0,"start":12801277,"end":12801434,"audio":false},{"filename":"/songs/menu/rough.ogg","crunched":0,"start":12801434,"end":13263896,"audio":true},{"filename":"/songs/menu/soft.ogg","crunched":0,"start":13263896,"end":13695876,"audio":true},{"filename":"/songs/menu/thisis.ogg","crunched":0,"start":13695876,"end":14128297,"audio":true},{"filename":"/songs/menu/you.ogg","crunched":0,"start":14128297,"end":14560633,"audio":true},{"filename":"/sounds/8bitclick.wav","crunched":0,"start":14560633,"end":14639063,"audio":true},{"filename":"/sounds/actcomplete.wav","crunched":0,"start":14639063,"end":15273525,"audio":true},{"filename":"/sounds/bigwin.wav","crunched":0,"start":15273525,"end":16860307,"audio":true},{"filename":"/sounds/boost.wav","crunched":0,"start":16860307,"end":16880317,"audio":true},{"filename":"/sounds/checkpoint.wav","crunched":0,"start":16880317,"end":16946413,"audio":true},{"filename":"/sounds/click.wav","crunched":0,"start":16946413,"end":16952555,"audio":true},{"filename":"/sounds/clickloop.wav","crunched":0,"start":16952555,"end":17064777,"audio":true},{"filename":"/sounds/death.wav","crunched":0,"start":17064777,"end":17215399,"audio":true},{"filename":"/sounds/fragment.wav","crunched":0,"start":17215399,"end":17531909,"audio":true},{"filename":"/sounds/fragmentfail.wav","crunched":0,"start":17531909,"end":17848419,"audio":true},{"filename":"/sounds/jump.wav","crunched":0,"start":17848419,"end":17863823,"audio":true},{"filename":"/sounds/one.wav","crunched":0,"start":17863823,"end":17976045,"audio":true},{"filename":"/sounds/pause.wav","crunched":0,"start":17976045,"end":18126667,"audio":true},{"filename":"/sounds/play.wav","crunched":0,"start":18126667,"end":18427817,"audio":true},{"filename":"/sounds/quit.wav","crunched":0,"start":18427817,"end":18578439,"audio":true},{"filename":"/sounds/respawn.wav","crunched":0,"start":18578439,"end":18725301,"audio":true},{"filename":"/sounds/resume.wav","crunched":0,"start":18725301,"end":18875923,"audio":true},{"filename":"/sounds/secretexit.wav","crunched":0,"start":18875923,"end":19510385,"audio":true},{"filename":"/sounds/spring.wav","crunched":0,"start":19510385,"end":19537847,"audio":true},{"filename":"/sounds/temphit.wav","crunched":0,"start":19537847,"end":19650069,"audio":true},{"filename":"/sounds/tempthump.wav","crunched":0,"start":19650069,"end":19762291,"audio":true},{"filename":"/sounds/three.wav","crunched":0,"start":19762291,"end":19874513,"audio":true},{"filename":"/sounds/two.wav","crunched":0,"start":19874513,"end":19986735,"audio":true},{"filename":"/sounds/wallboostplaceholder.wav","crunched":0,"start":19986735,"end":20145037,"audio":true},{"filename":"/sounds/water.mp3","crunched":0,"start":20145037,"end":20178473,"audio":true},{"filename":"/sounds/win.wav","crunched":0,"start":20178473,"end":20971143,"audio":true},{"filename":"/sounds/woosh.mp3","crunched":0,"start":20971143,"end":20982183,"audio":true},{"filename":"/sounds.lua","crunched":0,"start":20982183,"end":20983778,"audio":false}]});

})();
