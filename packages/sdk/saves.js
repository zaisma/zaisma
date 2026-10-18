/*
 * Zaisma cloud saves, game side. The games server adds this to every page of a game
 * that has cloud saves on; games don't include it themselves.
 *
 * It only ever talks to the Zaisma game page around it (zaisma.com), never to a server,
 * and does nothing unless that page asks it to. The game page holds the player's
 * session and does the saving; this script only reads and writes the game's own
 * localStorage and IndexedDB, the storage the game already uses.
 *
 * A save is the game's localStorage as { key: value }. When the game also keeps data in
 * IndexedDB (Unity and Godot builds, localForage), it's { idb: [databases], local: { key: value } }.
 *
 * Two places it runs:
 *  - <game>/_zaisma/restore: before the game opens, it shows the game page what's saved
 *    on this device and puts the account's save in place if the page says so.
 *  - every game page: while the page says to sync, it sends the save over whenever it
 *    changes (checked every 30 seconds) and when the player leaves. When the page says to
 *    apply a save (a developer's change, for a game that takes it in place), it puts it in
 *    place while the game runs and says whether it could.
 */
(function () {
  "use strict";
  var site = __ZAISMA_SAVES__.site;
  // Databases of downloaded game files, not progress (like Unity's UnityCache): never copied.
  var SKIP = /cache/i;
  var VIEWS = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "DataView"];
  var global = typeof globalThis !== "undefined" ? globalThis : window;

  // Tests check the save format through this (test/node/saves.test.ts).
  if (__ZAISMA_SAVES__.test) return __ZAISMA_SAVES__.test({ encode: encode, decode: decode, saveText: saveText });
  if (window.parent === window) return;

  // --- The save format ---

  function snapshot() {
    var local = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      local[key] = localStorage.getItem(key);
    }
    return local;
  }
  // Keys sorted, so the same save is always the same text (matches canonicalSave on the server).
  function canonical(local) {
    var out = {};
    Object.keys(local)
      .sort()
      .forEach(function (key) {
        set(out, key, local[key]);
      });
    return JSON.stringify(out);
  }
  /** The whole save as text. idbText is the encoded databases, or "" when there are none. */
  function saveText(local, idbText) {
    return idbText ? '{"idb":' + idbText + ',"local":' + canonical(local) + "}" : canonical(local);
  }
  function set(target, key, entryValue) {
    if (key === "__proto__") Object.defineProperty(target, key, { value: entryValue, enumerable: true, writable: true, configurable: true });
    else target[key] = entryValue;
  }

  // IndexedDB holds more than JSON can (dates, binary data, files, maps), so those become
  // tagged objects: { "$z": [kind, ...] }. A plain object with its own "$z" key is tagged
  // too ("obj"), so nothing is ever mistaken for a tag. Blobs are read afterwards: their
  // reads go into `pending`.
  function encode(given, pending, seen) {
    if (given === null || typeof given === "boolean" || typeof given === "string") return given;
    if (typeof given === "number") return isFinite(given) && !(given === 0 && 1 / given < 0) ? given : { $z: ["num", given === 0 ? "-0" : String(given)] };
    if (given === undefined) return { $z: ["undef"] };
    if (typeof given === "bigint") return { $z: ["bigint", given.toString()] };
    if (typeof given !== "object") throw new Error("Can't save a " + typeof given);
    if (seen.indexOf(given) !== -1) throw new Error("Can't save a value that contains itself");
    var kind = Object.prototype.toString.call(given).slice(8, -1);
    if (kind === "Date") return { $z: ["date", encode(given.getTime(), pending, seen)] };
    if (kind === "RegExp") return { $z: ["regexp", given.source, given.flags] };
    if (kind === "ArrayBuffer") return { $z: ["bytes", toBase64(new Uint8Array(given))] };
    if (ArrayBuffer.isView(given)) return { $z: ["view", VIEWS.indexOf(kind) === -1 ? "Uint8Array" : kind, toBase64(new Uint8Array(given.buffer, given.byteOffset, given.byteLength))] };
    if (kind === "Blob" || kind === "File") {
      var tag = kind === "File" ? { $z: ["file", given.type, "", given.name, given.lastModified] } : { $z: ["blob", given.type, ""] };
      pending.push(
        given.arrayBuffer().then(function (buffer) {
          tag.$z[2] = toBase64(new Uint8Array(buffer));
        }),
      );
      return tag;
    }
    seen.push(given);
    var out;
    if (kind === "Map" || kind === "Set") {
      var items = [];
      given.forEach(function (entryValue, key) {
        items.push(kind === "Map" ? [encode(key, pending, seen), encode(entryValue, pending, seen)] : encode(entryValue, pending, seen));
      });
      out = { $z: [kind === "Map" ? "map" : "set", items] };
    } else if (Array.isArray(given)) {
      out = [];
      for (var i = 0; i < given.length; i++) out.push(encode(given[i], pending, seen));
    } else {
      out = {};
      Object.keys(given).forEach(function (key) {
        set(out, key, encode(given[key], pending, seen));
      });
      if (Object.prototype.hasOwnProperty.call(given, "$z")) out = { $z: ["obj", out] };
    }
    seen.pop();
    return out;
  }

  function decode(encoded) {
    if (encoded === null || typeof encoded !== "object") return encoded;
    if (Array.isArray(encoded)) return encoded.map(decode);
    var tag = Object.prototype.hasOwnProperty.call(encoded, "$z") ? encoded.$z : null;
    if (!Array.isArray(tag)) return plain(encoded);
    switch (tag[0]) {
      case "num":
        return Number(tag[1]);
      case "undef":
        return undefined;
      case "bigint":
        return BigInt(tag[1]);
      case "date":
        return new Date(decode(tag[1]));
      case "regexp":
        return new RegExp(tag[1], tag[2]);
      case "bytes":
        return fromBase64(tag[1]).buffer;
      case "view":
        var bytes = fromBase64(tag[2]);
        if (tag[1] === "DataView") return new DataView(bytes.buffer);
        return VIEWS.indexOf(tag[1]) === -1 ? bytes : new global[tag[1]](bytes.buffer);
      case "blob":
        return new Blob([fromBase64(tag[2])], { type: tag[1] });
      case "file":
        return new File([fromBase64(tag[2])], tag[3], { type: tag[1], lastModified: tag[4] });
      case "map":
        return new Map(
          tag[1].map(function (entry) {
            return [decode(entry[0]), decode(entry[1])];
          }),
        );
      case "set":
        return new Set(tag[1].map(decode));
      case "obj":
        return plain(tag[1]);
    }
    return plain(encoded);
  }
  function plain(object) {
    var out = {};
    Object.keys(object).forEach(function (key) {
      set(out, key, decode(object[key]));
    });
    return out;
  }

  function toBase64(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  function fromBase64(text) {
    var binary = atob(text);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  // --- IndexedDB ---

  function request(databaseRequest) {
    return new Promise(function (ok, fail) {
      databaseRequest.onsuccess = function () {
        ok(databaseRequest.result);
      };
      databaseRequest.onerror = function () {
        fail(databaseRequest.error);
      };
    });
  }
  function names() {
    if (!window.indexedDB || !indexedDB.databases) return Promise.resolve([]);
    return indexedDB.databases().then(function (list) {
      return list
        .map(function (database) {
          return database.name;
        })
        .filter(function (name) {
          return typeof name === "string" && !SKIP.test(name);
        })
        .sort();
    });
  }
  function open(name, version, upgrade) {
    return new Promise(function (ok, fail) {
      var opening = version ? indexedDB.open(name, version) : indexedDB.open(name);
      opening.onupgradeneeded = function () {
        if (upgrade) upgrade(opening.result);
      };
      opening.onsuccess = function () {
        var database = opening.result;
        // Never hold up the game's own database upgrades.
        database.onversionchange = function () {
          database.close();
        };
        ok(database);
      };
      opening.onerror = function () {
        fail(opening.error);
      };
    });
  }
  function storeNames(database) {
    return Array.prototype.slice.call(database.objectStoreNames).sort();
  }
  /** How a store is set up, in a fixed shape so two can be compared as text. */
  function shape(store) {
    return {
      name: store.name,
      keyPath: keyPath(store.keyPath),
      autoIncrement: store.autoIncrement,
      indexes: Array.prototype.slice
        .call(store.indexNames)
        .sort()
        .map(function (name) {
          var index = store.index(name);
          return { name: name, keyPath: keyPath(index.keyPath), unique: index.unique, multiEntry: index.multiEntry };
        }),
    };
  }
  function savedShape(saved) {
    return { name: saved.name, keyPath: saved.keyPath, autoIncrement: saved.autoIncrement, indexes: saved.indexes };
  }
  // A key path is a name, a list of names (some browsers give a DOMStringList) or none.
  function keyPath(path) {
    return path === null || typeof path === "string" ? path : Array.prototype.slice.call(path);
  }

  /**
   * Every database the game keeps, sorted by name so the same data always reads the same:
   * [{ name, version, stores: [{ name, keyPath, autoIncrement, indexes, records: [[key, value]] }] }].
   * Databases with nothing in them are left out.
   */
  function readDatabases() {
    return names().then(function (list) {
      return Promise.all(list.map(readDatabase)).then(function (databases) {
        return databases.filter(Boolean);
      });
    });
  }
  function readDatabase(name) {
    var created = false;
    return open(name, 0, function () {
      created = true;
    }).then(function (database) {
      var stores = storeNames(database);
      if (created || !stores.length) {
        database.close();
        // It was deleted after the list was read; don't leave an empty one behind.
        if (created) indexedDB.deleteDatabase(name);
        return null;
      }
      return new Promise(function (ok, fail) {
        var transaction = database.transaction(stores, "readonly");
        var out = stores.map(function (storeName) {
          var store = transaction.objectStore(storeName);
          var copy = shape(store);
          var keys = store.getAllKeys();
          var values = store.getAll();
          values.onsuccess = function () {
            copy.records = values.result.map(function (record, i) {
              return [keys.result[i], record];
            });
          };
          return copy;
        });
        transaction.oncomplete = function () {
          database.close();
          var hasRecords = out.some(function (copied) {
            return copied.records.length;
          });
          ok(hasRecords ? { name: name, version: database.version, stores: out } : null);
        };
        transaction.onerror = transaction.onabort = function () {
          database.close();
          fail(transaction.error);
        };
      });
    });
  }
  /** The databases as save text: "" when there are none. */
  function readIdbText() {
    return readDatabases().then(function (databases) {
      if (!databases.length) return "";
      var pending = [];
      var out = encode(databases, pending, []);
      return Promise.all(pending).then(function () {
        return JSON.stringify(out);
      });
    });
  }

  /**
   * Make IndexedDB hold exactly `dbs`. A database set up the same way is emptied and
   * refilled; one set up differently (another version of the game) is deleted and made
   * again, which waits while the game is open in another tab (onBlocked says so).
   */
  function writeDatabases(databases, onBlocked) {
    var wanted = {};
    databases.forEach(function (database) {
      wanted[database.name] = database;
    });
    return names().then(function (list) {
      var here = {};
      list.forEach(function (name) {
        here[name] = true;
      });
      var empty = list.filter(function (name) {
        return !wanted[name];
      });
      return Promise.all(
        empty
          .map(function (name) {
            return fill(name, null, true, onBlocked);
          })
          .concat(
            databases.map(function (database) {
              return fill(database.name, database, Boolean(here[database.name]), onBlocked);
            }),
          ),
      );
    });
  }
  function fill(name, saved, exists, onBlocked) {
    if (!exists) return saved ? create(saved) : Promise.resolve();
    return open(name).then(function (database) {
      if (!saved || (database.version === saved.version && sameShape(database, saved))) return write(database, saved);
      database.close();
      return drop(name, onBlocked).then(function () {
        return create(saved);
      });
    });
  }
  function sameShape(database, saved) {
    var stores = storeNames(database);
    var theirs = saved.stores.map(savedShape).sort(function (first, second) {
      return first.name < second.name ? -1 : 1;
    });
    if (stores.join("\n") !== theirs.map(function (stored) { return stored.name; }).join("\n")) return false;
    if (!stores.length) return true;
    var transaction = database.transaction(stores, "readonly");
    return JSON.stringify(stores.map(function (storeName) { return shape(transaction.objectStore(storeName)); })) === JSON.stringify(theirs);
  }
  function create(saved) {
    return open(saved.name, saved.version, function (database) {
      saved.stores.forEach(function (stored) {
        var store = database.createObjectStore(stored.name, { keyPath: stored.keyPath, autoIncrement: stored.autoIncrement });
        stored.indexes.forEach(function (savedIndex) {
          store.createIndex(savedIndex.name, savedIndex.keyPath, { unique: savedIndex.unique, multiEntry: savedIndex.multiEntry });
        });
      });
    }).then(function (database) {
      return write(database, saved);
    });
  }
  /** Empty every store, then put the saved records back (when there are any). */
  function write(database, saved) {
    var stores = storeNames(database);
    if (!stores.length) {
      database.close();
      return Promise.resolve();
    }
    return new Promise(function (ok, fail) {
      var transaction = database.transaction(stores, "readwrite");
      transaction.oncomplete = function () {
        database.close();
        ok();
      };
      transaction.onerror = transaction.onabort = function () {
        database.close();
        fail(transaction.error);
      };
      try {
        stores.forEach(function (storeName) {
          transaction.objectStore(storeName).clear();
        });
        (saved ? saved.stores : []).forEach(function (stored) {
          var store = transaction.objectStore(stored.name);
          stored.records.forEach(function (record) {
            if (store.keyPath === null) store.put(record[1], record[0]);
            else store.put(record[1]);
          });
        });
      } catch (error) {
        transaction.abort();
      }
    });
  }
  function drop(name, onBlocked) {
    var deleting = indexedDB.deleteDatabase(name);
    deleting.onblocked = onBlocked;
    return request(deleting);
  }

  /** Put the account's save in place of this device's. onBlocked: it's waiting on another tab. */
  function putSave(save, onBlocked) {
    var both = Array.isArray(save.idb) && save.local && typeof save.local === "object";
    var local = both ? save.local : save;
    var databases = both ? decode(save.idb) : [];
    // IndexedDB first: it's the part that can fail, and then localStorage is still as it was.
    var writing =
      window.indexedDB && indexedDB.databases
        ? writeDatabases(databases, onBlocked)
        : databases.length
          ? Promise.reject(new Error("No IndexedDB here"))
          : Promise.resolve();
    return writing.then(function () {
      localStorage.clear();
      Object.keys(local).forEach(function (key) {
        localStorage.setItem(key, String(local[key]));
      });
    });
  }

  // --- Talking to the game page ---

  function post(message) {
    message.type = "zaisma:saves";
    parent.postMessage(message, site);
  }
  function listen(listener) {
    addEventListener("message", function (event) {
      if (event.origin !== site || event.source !== parent || !event.data || event.data.type !== "zaisma:saves") return;
      listener(event.data);
    });
  }

  if (/\/_zaisma\/restore$/.test(location.pathname)) {
    // The game starts at its root, with the query the game page passed (like ?room=ABC234).
    var query = decodeURIComponent(location.hash.slice(1));
    var target = new URL("../" + (/^\?[\w=&%-]*$/.test(query) ? query : ""), location.href).href;
    var go = function () {
      location.replace(target);
    };
    // If the game page never answers, play anyway.
    var timer = setTimeout(go, 8000);
    // The game's database is open in another tab: say so here, where the player is looking.
    var blocked = function () {
      post({ step: "blocked" });
      if (document.getElementById("zaisma-blocked")) return;
      var note = document.createElement("p");
      note.id = "zaisma-blocked";
      note.textContent = "This game is open in another tab. Close it there to load your saved progress.";
      note.style.cssText = "margin:0;position:fixed;inset:0;display:grid;place-items:center;padding:24px;color:#d8dde3;font:16px/1.5 system-ui,sans-serif;text-align:center";
      document.body.appendChild(note);
    };
    listen(function (message) {
      // The player is choosing between two saves: wait for them.
      if (message.step === "wait") clearTimeout(timer);
      if (message.step !== "restore") return;
      clearTimeout(timer);
      if (message.action !== "use-cloud" || !message.data || typeof message.data !== "object") return go();
      Promise.resolve(message.data)
        .then(function (save) {
          return putSave(save, blocked);
        })
        .then(
          function () {
            post({ step: "restored", ok: true });
          },
          function () {
            post({ step: "restored", ok: false });
          },
        )
        .then(go);
    });
    // A device whose saves can't be read plays without saving to the account (broken).
    readIdbText()
      .then(function (idbText) {
        return saveText(snapshot(), idbText);
      })
      .then(
        function (text) {
          post({ step: "hello", phase: "restore", text: text });
        },
        function () {
          post({ step: "hello", phase: "restore", text: "", broken: true });
        },
      );
    return;
  }

  // Writes to IndexedDB mark the save as changed, so the databases are only read again
  // after the game wrote to them (and every few minutes, in case a worker wrote).
  var idbChanged = true;
  function watch(prototype, methods) {
    methods.forEach(function (name) {
      var original = prototype && prototype[name];
      if (typeof original !== "function") return;
      prototype[name] = function () {
        idbChanged = true;
        return original.apply(this, arguments);
      };
    });
  }
  if (window.IDBObjectStore) {
    watch(IDBObjectStore.prototype, ["put", "add", "delete", "clear"]);
    watch(window.IDBCursor && IDBCursor.prototype, ["update", "delete"]);
    watch(IDBFactory.prototype, ["deleteDatabase"]);
  }

  var syncing = false;
  var last = null;
  var timer = null;
  var idbText = null;
  var checkCount = 0;
  var reading = false;
  var again = false;
  function check() {
    if (!syncing) return;
    if (reading) {
      again = true;
      return;
    }
    var readIdb = idbChanged || idbText === null || ++checkCount % 10 === 0;
    idbChanged = false;
    reading = true;
    (readIdb ? readIdbText() : Promise.resolve(idbText))
      .then(function (freshIdbText) {
        idbText = freshIdbText;
        var text = saveText(snapshot(), freshIdbText);
        if (text === last) return;
        last = text;
        post({ step: "save", text: text });
      })
      // Nothing is sent when the save can't be read, so a half-read save never replaces a whole one.
      .catch(function () {
        idbChanged = true;
      })
      .then(function () {
        reading = false;
        if (again) {
          again = false;
          check();
        }
      });
  }
  listen(function (message) {
    if (message.step === "sync") {
      syncing = true;
      last = typeof message.text === "string" ? message.text : null;
      clearInterval(timer);
      timer = setInterval(check, 30000);
      check();
    } else if (message.step === "pause") {
      syncing = false;
      clearInterval(timer);
    } else if (message.step === "apply" && message.data && typeof message.data === "object") {
      apply(message.data);
    }
  });
  // Put a save in place under the running game. A database the game holds open can't be set up again
  // while it runs, so that fails at once (the page reloads the game instead) rather than waiting.
  function apply(save) {
    new Promise(function (ok, fail) {
      putSave(save, function () {
        fail(new Error("The game holds its database open"));
      }).then(ok, fail);
    })
      .then(function () {
        // What's in storage now is the save the page sent: the next check has nothing new to send.
        return readIdbText();
      })
      .then(
        function (freshIdbText) {
          idbText = freshIdbText;
          idbChanged = false;
          last = saveText(snapshot(), freshIdbText);
          post({ step: "applied", ok: true });
        },
        function () {
          post({ step: "applied", ok: false });
        },
      );
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") check();
  });
  addEventListener("pagehide", check);
  post({ step: "hello", phase: "game" });
})();
