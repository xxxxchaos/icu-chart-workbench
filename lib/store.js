import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function today(date = new Date()) {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}
export function days(start, end) {
  return (Date.parse(end) - Date.parse(start)) / 86400000 + 1
}
export function openStore(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(join(dir, 'workbench.db'))
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, payload TEXT NOT NULL)',
  )
  const read = db.prepare('SELECT payload FROM cases WHERE id=?')
  const put = db.prepare('UPDATE cases SET payload=? WHERE id=?')
  const get = (id) => {
    const row = read.get(id)
    if (!row) throw Error('患者卡不存在，请返回列表')
    return JSON.parse(row.payload)
  }
  return {
    list: () =>
      db
        .prepare(
          "SELECT json_extract(payload,'$.name') name,json_extract(payload,'$.bed') bed,json_extract(payload,'$.admission') admission,json_extract(payload,'$.entry') entry,(SELECT count(*) FROM json_each(json_extract(cases.payload,'$.notes')) WHERE json_extract(value,'$.day')=?) notesToday,json_extract(payload,'$.archived') archived,id FROM cases ORDER BY rowid DESC",
        )
        .all(today()),
    get,
    create(fields) {
      const { name, bed, admission, entry } = fields
      const validDate = (v) =>
        typeof v === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(v) &&
        Number.isFinite(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v
      if (
        !name?.trim() ||
        !validDate(admission) ||
        !validDate(entry) ||
        admission > entry ||
        entry > today()
      )
        throw Error('请核对姓名、入院日期和入科日期')
      const id = randomUUID()
      db.prepare('INSERT INTO cases VALUES (?,?)').run(
        id,
        JSON.stringify({
          id,
          name: name.trim(),
          bed,
          admission,
          entry,
          sources: [],
          notes: [],
          archived: false,
        }),
      )
      return id
    },
    change(id, edit) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const c = get(id)
        edit(c)
        put.run(JSON.stringify(c), id)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    close: () => db.close(),
  }
}
