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
 *    changes (checked every 30 seconds) and when the player leaves.
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
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      data[key] = localStorage.getItem(key);
    }
    return data;
  }
  // Keys sorted, so the same save is always the same text (matches canonicalSave on the server).
  function canonical(data) {
    var out = {};
    Object.keys(data)
      .sort()
      .forEach(function (k) {
        set(out, k, data[k]);
      });
    return JSON.stringify(out);
  }
  /** The whole save as text. idbText is the encoded databases, or "" when there are none. */
  function saveText(local, idbText) {
    return idbText ? '{"idb":' + idbText + ',"local":' + canonical(local) + "}" : canonical(local);
  }
  function set(obj, key, value) {
    if (key === "__proto__") Object.defineProperty(obj, key, { value: value, enumerable: true, writable: true, configurable: true });
    else obj[key] = value;
  }

  // IndexedDB holds more than JSON can (dates, binary data, files, maps), so those become
  // tagged objects: { "$z": [kind, ...] }. A plain object with its own "$z" key is tagged
  // too ("obj"), so nothing is ever mistaken for a tag. Blobs are read afterwards: their
  // reads go into `pending`.
  function encode(v, pending, seen) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "number") return isFinite(v) && !(v === 0 && 1 / v < 0) ? v : { $z: ["num", v === 0 ? "-0" : String(v)] };
    if (v === undefined) return { $z: ["undef"] };
    if (typeof v === "bigint") return { $z: ["bigint", v.toString()] };
    if (typeof v !== "object") throw new Error("Can't save a " + typeof v);
    if (seen.indexOf(v) !== -1) throw new Error("Can't save a value that contains itself");
    var kind = Object.prototype.toString.call(v).slice(8, -1);
    if (kind === "Date") return { $z: ["date", encode(v.getTime(), pending, seen)] };
    if (kind === "RegExp") return { $z: ["regexp", v.source, v.flags] };
    if (kind === "ArrayBuffer") return { $z: ["bytes", b64(new Uint8Array(v))] };
    if (ArrayBuffer.isView(v)) return { $z: ["view", VIEWS.indexOf(kind) === -1 ? "Uint8Array" : kind, b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))] };
    if (kind === "Blob" || kind === "File") {
      var tag = kind === "File" ? { $z: ["file", v.type, "", v.name, v.lastModified] } : { $z: ["blob", v.type, ""] };
      pending.push(
        v.arrayBuffer().then(function (buf) {
          tag.$z[2] = b64(new Uint8Array(buf));
        }),
      );
      return tag;
    }
    seen.push(v);
    var out;
    if (kind === "Map" || kind === "Set") {
      var items = [];
      v.forEach(function (value, key) {
        items.push(kind === "Map" ? [encode(key, pending, seen), encode(value, pending, seen)] : encode(value, pending, seen));
      });
      out = { $z: [kind === "Map" ? "map" : "set", items] };
    } else if (Array.isArray(v)) {
      out = [];
      for (var i = 0; i < v.length; i++) out.push(encode(v[i], pending, seen));
    } else {
      out = {};
      Object.keys(v).forEach(function (k) {
        set(out, k, encode(v[k], pending, seen));
      });
      if (Object.prototype.hasOwnProperty.call(v, "$z")) out = { $z: ["obj", out] };
    }
    seen.pop();
    return out;
  }

  function decode(v) {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(decode);
    var z = Object.prototype.hasOwnProperty.call(v, "$z") ? v.$z : null;
    if (!Array.isArray(z)) return plain(v);
    switch (z[0]) {
      case "num":
        return Number(z[1]);
      case "undef":
        return undefined;
      case "bigint":
        return BigInt(z[1]);
      case "date":
        return new Date(decode(z[1]));
      case "regexp":
        return new RegExp(z[1], z[2]);
      case "bytes":
        return unb64(z[1]).buffer;
      case "view":
        var bytes = unb64(z[2]);
        if (z[1] === "DataView") return new DataView(bytes.buffer);
        return VIEWS.indexOf(z[1]) === -1 ? bytes : new global[z[1]](bytes.buffer);
      case "blob":
        return new Blob([unb64(z[2])], { type: z[1] });
      case "file":
        return new File([unb64(z[2])], z[3], { type: z[1], lastModified: z[4] });
      case "map":
        return new Map(
          z[1].map(function (e) {
            return [decode(e[0]), decode(e[1])];
          }),
        );
      case "set":
        return new Set(z[1].map(decode));
      case "obj":
        return plain(z[1]);
    }
    return plain(v);
  }
  function plain(o) {
    var out = {};
    Object.keys(o).forEach(function (k) {
      set(out, k, decode(o[k]));
    });
    return out;
  }

  function b64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(text) {
    var s = atob(text);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // --- IndexedDB ---

  function request(r) {
    return new Promise(function (ok, fail) {
      r.onsuccess = function () {
        ok(r.result);
      };
      r.onerror = function () {
        fail(r.error);
      };
    });
  }
  function names() {
    if (!window.indexedDB || !indexedDB.databases) return Promise.resolve([]);
    return indexedDB.databases().then(function (list) {
      return list
        .map(function (d) {
          return d.name;
        })
        .filter(function (n) {
          return typeof n === "string" && !SKIP.test(n);
        })
        .sort();
    });
  }
  function open(name, version, upgrade) {
    return new Promise(function (ok, fail) {
      var r = version ? indexedDB.open(name, version) : indexedDB.open(name);
      r.onupgradeneeded = function () {
        if (upgrade) upgrade(r.result);
      };
      r.onsuccess = function () {
        var db = r.result;
        // Never hold up the game's own database upgrades.
        db.onversionchange = function () {
          db.close();
        };
        ok(db);
      };
      r.onerror = function () {
        fail(r.error);
      };
    });
  }
  function storeNames(db) {
    return Array.prototype.slice.call(db.objectStoreNames).sort();
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
  function savedShape(s) {
    return { name: s.name, keyPath: s.keyPath, autoIncrement: s.autoIncrement, indexes: s.indexes };
  }
  // A key path is a name, a list of names (some browsers give a DOMStringList) or none.
  function keyPath(p) {
    return p === null || typeof p === "string" ? p : Array.prototype.slice.call(p);
  }

  /**
   * Every database the game keeps, sorted by name so the same data always reads the same:
   * [{ name, version, stores: [{ name, keyPath, autoIncrement, indexes, records: [[key, value]] }] }].
   * Databases with nothing in them are left out.
   */
  function readDatabases() {
    return names().then(function (list) {
      return Promise.all(list.map(readDatabase)).then(function (dbs) {
        return dbs.filter(Boolean);
      });
    });
  }
  function readDatabase(name) {
    var created = false;
    return open(name, 0, function () {
      created = true;
    }).then(function (db) {
      var stores = storeNames(db);
      if (created || !stores.length) {
        db.close();
        // It was deleted after the list was read; don't leave an empty one behind.
        if (created) indexedDB.deleteDatabase(name);
        return null;
      }
      return new Promise(function (ok, fail) {
        var tx = db.transaction(stores, "readonly");
        var out = stores.map(function (s) {
          var store = tx.objectStore(s);
          var item = shape(store);
          var keys = store.getAllKeys();
          var values = store.getAll();
          values.onsuccess = function () {
            item.records = values.result.map(function (value, i) {
              return [keys.result[i], value];
            });
          };
          return item;
        });
        tx.oncomplete = function () {
          db.close();
          var any = out.some(function (s) {
            return s.records.length;
          });
          ok(any ? { name: name, version: db.version, stores: out } : null);
        };
        tx.onerror = tx.onabort = function () {
          db.close();
          fail(tx.error);
        };
      });
    });
  }
  /** The databases as save text: "" when there are none. */
  function readIdbText() {
    return readDatabases().then(function (dbs) {
      if (!dbs.length) return "";
      var pending = [];
      var out = encode(dbs, pending, []);
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
  function writeDatabases(dbs, onBlocked) {
    var wanted = {};
    dbs.forEach(function (d) {
      wanted[d.name] = d;
    });
    return names().then(function (list) {
      var here = {};
      list.forEach(function (n) {
        here[n] = true;
      });
      var empty = list.filter(function (n) {
        return !wanted[n];
      });
      return Promise.all(
        empty
          .map(function (n) {
            return fill(n, null, true, onBlocked);
          })
          .concat(
            dbs.map(function (d) {
              return fill(d.name, d, Boolean(here[d.name]), onBlocked);
            }),
          ),
      );
    });
  }
  function fill(name, saved, exists, onBlocked) {
    if (!exists) return saved ? create(saved) : Promise.resolve();
    return open(name).then(function (db) {
      if (!saved || (db.version === saved.version && sameShape(db, saved))) return write(db, saved);
      db.close();
      return drop(name, onBlocked).then(function () {
        return create(saved);
      });
    });
  }
  function sameShape(db, saved) {
    var stores = storeNames(db);
    var theirs = saved.stores.map(savedShape).sort(function (a, b) {
      return a.name < b.name ? -1 : 1;
    });
    if (stores.join("\n") !== theirs.map(function (s) { return s.name; }).join("\n")) return false;
    if (!stores.length) return true;
    var tx = db.transaction(stores, "readonly");
    return JSON.stringify(stores.map(function (s) { return shape(tx.objectStore(s)); })) === JSON.stringify(theirs);
  }
  function create(saved) {
    return open(saved.name, saved.version, function (db) {
      saved.stores.forEach(function (s) {
        var store = db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
        s.indexes.forEach(function (i) {
          store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
        });
      });
    }).then(function (db) {
      return write(db, saved);
    });
  }
  /** Empty every store, then put the saved records back (when there are any). */
  function write(db, saved) {
    var stores = storeNames(db);
    if (!stores.length) {
      db.close();
      return Promise.resolve();
    }
    return new Promise(function (ok, fail) {
      var tx = db.transaction(stores, "readwrite");
      tx.oncomplete = function () {
        db.close();
        ok();
      };
      tx.onerror = tx.onabort = function () {
        db.close();
        fail(tx.error);
      };
      try {
        stores.forEach(function (s) {
          tx.objectStore(s).clear();
        });
        (saved ? saved.stores : []).forEach(function (s) {
          var store = tx.objectStore(s.name);
          s.records.forEach(function (r) {
            if (store.keyPath === null) store.put(r[1], r[0]);
            else store.put(r[1]);
          });
        });
      } catch (err) {
        tx.abort();
      }
    });
  }
  function drop(name, onBlocked) {
    var r = indexedDB.deleteDatabase(name);
    r.onblocked = onBlocked;
    return request(r);
  }

  /** Put the account's save in place of this device's. onBlocked: it's waiting on another tab. */
  function putSave(data, onBlocked) {
    var both = Array.isArray(data.idb) && data.local && typeof data.local === "object";
    var local = both ? data.local : data;
    var dbs = both ? decode(data.idb) : [];
    // IndexedDB first: it's the part that can fail, and then localStorage is still as it was.
    var idb =
      window.indexedDB && indexedDB.databases
        ? writeDatabases(dbs, onBlocked)
        : dbs.length
          ? Promise.reject(new Error("No IndexedDB here"))
          : Promise.resolve();
    return idb.then(function () {
      localStorage.clear();
      Object.keys(local).forEach(function (k) {
        localStorage.setItem(k, String(local[k]));
      });
    });
  }

  // --- Talking to the game page ---

  function post(msg) {
    msg.type = "zaisma:saves";
    parent.postMessage(msg, site);
  }
  function listen(fn) {
    addEventListener("message", function (e) {
      if (e.origin !== site || e.source !== parent || !e.data || e.data.type !== "zaisma:saves") return;
      fn(e.data);
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
    listen(function (m) {
      // The player is choosing between two saves: wait for them.
      if (m.step === "wait") clearTimeout(timer);
      if (m.step !== "restore") return;
      clearTimeout(timer);
      if (m.action !== "use-cloud" || !m.data || typeof m.data !== "object") return go();
      Promise.resolve(m.data)
        .then(function (data) {
          return putSave(data, blocked);
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
  function watch(proto, methods) {
    methods.forEach(function (name) {
      var fn = proto && proto[name];
      if (typeof fn !== "function") return;
      proto[name] = function () {
        idbChanged = true;
        return fn.apply(this, arguments);
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
  var checks = 0;
  var reading = false;
  var again = false;
  function check() {
    if (!syncing) return;
    if (reading) {
      again = true;
      return;
    }
    var readIdb = idbChanged || idbText === null || ++checks % 10 === 0;
    idbChanged = false;
    reading = true;
    (readIdb ? readIdbText() : Promise.resolve(idbText))
      .then(function (t) {
        idbText = t;
        var text = saveText(snapshot(), t);
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
  listen(function (m) {
    if (m.step === "sync") {
      syncing = true;
      last = typeof m.text === "string" ? m.text : null;
      clearInterval(timer);
      timer = setInterval(check, 30000);
      check();
    } else if (m.step === "pause") {
      syncing = false;
      clearInterval(timer);
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") check();
  });
  addEventListener("pagehide", check);
  post({ step: "hello", phase: "game" });
})();
