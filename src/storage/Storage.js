const sqlite3 = require("sqlite3").verbose();

/**
 * @typedef {{
 *    url: string,
 *    title: string,
 *    description: string,
 *    duration: number,
 *    viewCount: number,
 *    videoUrl: string,
 * }} StorageItem
 */

class Storage {
  db;

  /**
   * @type {Promise<boolean>} prepared
   */
  prepared;

  constructor(fileName = ":memory:") {
    this.prepared = this.openDb(fileName).then(() => this.prepare());
  }

  destructor() {
    this.db.close();
  }

  async openDb(fileName) {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(fileName, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async checkTable(tableName) {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [tableName],
        (err, row) => {
          if (err) {
            reject(err);
          }
          if (row && row.name === tableName) {
            resolve(true);
          }
          resolve(false);
        },
      );
    });
  }

  async prepare() {
    const p = [];
    if (!(await this.checkTable("detail"))) {
      p.push(
        new Promise((resolve, reject) => {
          this.db.run(
            "CREATE VIRTUAL TABLE detail USING fts3(url TEXT, title TEXT, description TEXT, duration INTEGER, view_count INTEGER, video TEXT, subtitles TEXT,  UNIQUE(url))",
            (err) => (err ? reject(err) : resolve()),
          );
          console.log("Table DETAIL created");
        }),
      );
    }
    if (!(await this.checkTable("config"))) {
      p.push(
        new Promise((resolve, reject) => {
          this.db.run(
            "CREATE TABLE config (key TEXT, value TEXT, UNIQUE(key))",
            (err) => (err ? reject(err) : resolve()),
          );
          console.log("Table CONFIG created");
        }),
      );
    }
    return Promise.all(p);
  }

  setMeta(key, value) {
    console.log("Update meta", key, value);
    return new Promise((resolve, reject) => {
      const params = {
        $key: key,
        $value: value,
      };
      this.db.run(
        "INSERT INTO config (key, value) VALUES ($key, $value) " +
          "ON CONFLICT (key) DO UPDATE SET value=$value WHERE key=$key",
        params,
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  getMeta(key) {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT value FROM config WHERE key=$key",
        { $key: key },
        (err, row) => (row ? resolve(row["value"]) : resolve(undefined)),
      );
    });
  }

  /**
   *
   * @param {StorageItem} item
   */
  insert(item) {
    return new Promise((resolve, reject) => {
      const params = {
        $url: item.url,
        $title: item.title,
        $description: item.description,
        $duration: item.duration,
        $view_count: item.viewCount,
        $video: item.videoUrl,
      };
      this.db.run(
        "INSERT INTO detail (url, title, description, duration, view_count, video) VALUES ($url, $title, $description, $duration, $view_count, $video)",
        params,
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  /**
   *
   * @param {StorageItem} item
   */
  upsert(item) {
    const params = {
      $url: item.url,
      $title: item.title,
      $description: item.description,
      $duration: item.duration,
      $view_count: item.viewCount,
      $video: item.videoUrl,
    };
    return new Promise((resolve, reject) => {
      this.db.run(
        "UPDATE detail SET title=$title, description=$description, duration=$duration, view_count=$view_count, video=$video WHERE url=$url",
        params,
        function (err) {
          err ? reject(err) : resolve(this.changes);
        },
      );
    }).then((updated) => {
      if (updated) {
        return;
      }
      return new Promise((resolve, reject) => {
        this.db.run(
          "INSERT INTO detail (url, title, description, duration, view_count, video) VALUES ($url, $title, $description, $duration, $view_count, $video)",
          params,
          (err) => (err ? reject(err) : resolve()),
        );
      });
    });
  }

  beginTransaction() {
    console.log("Begin transaction");
    return new Promise((resolve, reject) => {
      this.db.run("BEGIN TRANSACTION;", (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  commitTransaction() {
    console.log("Commit transaction");
    return new Promise((resolve, reject) => {
      this.db.run("COMMIT;", (err) => (err ? reject(err) : resolve()));
    });
  }

  count() {
    return new Promise((resolve, reject) => {
      this.db.get("SELECT count(*) as cnt FROM detail", (err, row) => {
        row ? resolve(row["cnt"]) : reject(err);
      });
    });
  }

  search(text) {
    return new Promise((resolve, reject) => {
      this.db.all(
        "SELECT * FROM detail WHERE title MATCH ?",
        [text],
        (err, rows) => (err ? reject(err) : resolve(rows)),
      );
    });
  }
}

module.exports = { Storage };
