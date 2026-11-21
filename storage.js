(function () {
  "use strict";

  const DB_NAME = "cike-content-v1";
  const DB_VERSION = 2;
  let dbPromise;

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("books")) {
          db.createObjectStore("books", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("audio")) {
          db.createObjectStore("audio", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("audioMeta")) {
          db.createObjectStore("audioMeta", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function transaction(storeName, mode, operation) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try {
        result = operation(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  const api = {
    async putBook(book) {
      await transaction("books", "readwrite", (store) => store.put(book));
      return book;
    },
    async getBook(id) {
      const db = await openDatabase();
      return requestResult(db.transaction("books").objectStore("books").get(id));
    },
    async getAllBooks() {
      const db = await openDatabase();
      return requestResult(
        db.transaction("books").objectStore("books").getAll(),
      );
    },
    async deleteBook(id) {
      await transaction("books", "readwrite", (store) => store.delete(id));
    },
    async set(key, value) {
      await transaction("kv", "readwrite", (store) =>
        store.put({ key, value }),
      );
    },
    async get(key) {
      const db = await openDatabase();
      const row = await requestResult(
        db.transaction("kv").objectStore("kv").get(key),
      );
      return row?.value;
    },
    async putAudio(id, blob, meta) {
      await transaction("audio", "readwrite", (store) =>
        store.put({ id, blob }),
      );
      await transaction("audioMeta", "readwrite", (store) =>
        store.put({ id, ...meta }),
      );
    },
    async getAudio(id) {
      const db = await openDatabase();
      const row = await requestResult(
        db.transaction("audio").objectStore("audio").get(id),
      );
      return row?.blob || null;
    },
    async getAudioMeta(id) {
      const db = await openDatabase();
      return requestResult(
        db.transaction("audioMeta").objectStore("audioMeta").get(id),
      );
    },
    async getAllAudioMeta() {
      const db = await openDatabase();
      return requestResult(
        db.transaction("audioMeta").objectStore("audioMeta").getAll(),
      );
    },
    async deleteAudio(id) {
      await transaction("audio", "readwrite", (store) => store.delete(id));
      await transaction("audioMeta", "readwrite", (store) => store.delete(id));
    },
    async exportAll() {
      const [books] = await Promise.all([api.getAllBooks()]);
      return { books };
    },
  };

  window.CikeDB = api;
})();
