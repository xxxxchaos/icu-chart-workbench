import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { openStore, today, days } from './store.js'
import { generate, kinds } from './model.js'
import { recognize, preview } from './photo.js'

export const name = 'local-icu-workbench'
const text = (value) => ({ type: 'text', text: value })
const action = (id, args = {}) => ({ id, args })
const buttons = (...items) => ({
  type: 'actions',
  items: items.map(([label, id, args]) => ({
    label,
    action: action(id, args),
  })),
})
const field = (label, key, extra = {}) => ({
  type: 'textField',
  label,
  bind: 'data.form.' + key,
  ...extra,
})
const dateField = (label, key) => ({
  ...field(label, key),
  type: 'date',
  required: true,
})
const form = (label, id, children) => ({
  type: 'form',
  submit: id,
  submitLabel: label,
  children,
})
const list = (items) => ({ type: 'list', items })
const splitText = (value) => value.match(/[\s\S]{1,950}/gu) || ['']
function paginate(rows, page, children) {
  const max = Math.max(0, Math.ceil(rows.length / 8) - 1)
  const p = Math.max(0, Math.min(page || 0, max))
  if (rows.length) children.push(list(rows.slice(p * 8, p * 8 + 8)))
  const nav = []
  if (p > 0) nav.push(['上一页', 'page', { page: p - 1 }])
  if (p < max) nav.push(['下一页', 'page', { page: p + 1 }])
  if (nav.length) children.push(buttons(...nav))
}
export function buildPanel(ctx, dir) {
  let database
  const store = () => (database ??= openStore(dir))
  const screens = new Map(),
    jobs = new Map(),
    picks = new Map()
  const key = (s) => s?.sessionId || 'features'
  const state = (s) => screens.get(key(s)) || { screen: 'list', page: 0 }
  function go(s, next) {
    screens.set(key(s), { ...next, token: randomUUID() })
    return { refresh: true }
  }
  const photoFile = (id) => join(dir, 'photos', id)
  function current(s) {
    const v = state(s),
      c = v.id && store().get(v.id)
    const note = v.note && c.notes.find((n) => n.id === v.note)
    const src = v.src && c.sources.find((n) => n.id === v.src)
    return { v, c, note, src }
  }
  function display(s, caps = {}) {
    const { v, c, note, src } = current(s)
    const parts = [],
      values = {}
    const day = v.day || today()
    const back = (label, id) => parts.push(buttons([label, id]))
    if (v.screen === 'list') {
      parts.push(
        buttons(
          ['新建患者卡', 'newCase'],
          [v.archived ? '在科患者' : '已转出', 'archiveList'],
        ),
      )
      const cards = store()
        .list()
        .filter((p) => !!p.archived === !!v.archived)
      paginate(
        cards.map((p) => ({
          title: p.name,
          subtitle: [
            p.bed || '床号未填',
            '入院' +
              days(p.admission, today()) +
              '天 / ICU ' +
              days(p.entry, today()) +
              '天',
            '今日' + p.notesToday + '份',
          ].join(' · '),
          action: action('case', { id: p.id }),
        })),
        v.page,
        parts,
      )
      if (!cards.length)
        parts.push(text(v.archived ? '暂无转出记录' : '暂无在科患者'))
    } else if (v.screen === 'new') {
      back('返回患者列表', 'home')
      Object.assign(values, { admission: day, entry: day })
      parts.push(
        form('建立患者卡', 'create', [
          field('姓名', 'name', { required: true, maxLength: 50 }),
          field('床号', 'bed', { maxLength: 30 }),
          dateField('入院日期', 'admission'),
          dateField('本次 ICU 入科日期', 'entry'),
        ]),
      )
    } else {
      parts.push(
        text(
          c.name +
            ' · ' +
            (c.bed || '床号未填') +
            ' · ' +
            day +
            ' · ICU 第' +
            days(c.entry, day) +
            '天',
        ),
      )
      if (v.screen === 'case') {
        back('返回患者列表', 'home')
        parts.push(
          buttons(
            ['当日资料', 'sources'],
            ['文书历史', 'history'],
            ['患者卡设置', 'settings'],
          ),
        )
        const notes = c.notes.filter((n) => n.day === day).reverse()
        if (notes.length)
          parts.push(
            list(
              notes
                .slice(0, 5)
                .map((n) => ({
                  title: n.time.slice(-5) + ' ' + n.kind,
                  subtitle: n.confirmed ? '已确认' : '草稿',
                  action: action('note', { note: n.id }),
                })),
            ),
          )
        if (!c.archived) {
          if (caps.features?.includes('files'))
            parts.push(buttons(['添加照片', 'pick']))
          else parts.push(text('当前宿主未提供图片选择，可录入或粘贴文字。'))
          parts.push(
            form('保存补充', 'addText', [
              field('补充今日病情', 'input', {
                required: true,
                multiline: true,
                maxLength: 950,
              }),
            ]),
          )
          Object.assign(values, {
            kind: c.lastKind || kinds[0],
            doctor: c.doctor || '',
            period: '今晨',
            clock: new Date().toLocaleTimeString('en-GB', {
              timeZone: 'Asia/Shanghai',
              hour: '2-digit',
              minute: '2-digit',
            }),
          })
          parts.push(
            form('生成草稿', 'generate', [
              { ...field('文书类型', 'kind'), type: 'select', options: kinds },
              field('查房医师姓名及职称', 'doctor', { maxLength: 48 }),
              {
                ...field('查房时段', 'period'),
                type: 'select',
                options: ['今晨', '今日上午', '今日下午', '今晚'],
              },
              {
                ...field('实际记录时间', 'clock'),
                type: 'time',
                required: true,
              },
            ]),
          )
        }
        if (jobs.has(c.id))
          parts.push(
            text(jobs.get(c.id).message),
            buttons(['查看进度或草稿', 'reload']),
          )
      } else if (v.screen === 'settings') {
        back('返回工作台', 'backCase')
        values.bed = c.bed
        values.day = day
        parts.push(
          form('更新床号', 'bed', [field('床号', 'bed', { maxLength: 30 })]),
          form('切换日期', 'day', [dateField('文书日期', 'day')]),
          buttons([c.archived ? '恢复在科' : '标记转出', 'archive']),
        )
      } else if (v.screen === 'history' || v.screen === 'sources') {
        back('返回工作台', 'backCase')
        const rows =
          v.screen === 'history'
            ? c.notes
                .slice()
                .reverse()
                .map((n) => ({
                  title: n.time + ' ' + n.kind,
                  subtitle: n.confirmed ? '已确认' : '草稿',
                  action: action('note', { note: n.id }),
                }))
            : c.sources
                .filter(
                  (a) =>
                    a.day === day &&
                    (!v.sourceNote ||
                      c.notes
                        .find((n) => n.id === v.sourceNote)
                        ?.sourceIds?.includes(a.id)),
                )
                .reverse()
                .map((a) => ({
                  title: a.name,
                  subtitle: a.error || (a.verified ? '已核对' : '待核对'),
                  action: action('source', { src: a.id }),
                }))
        paginate(rows, v.page, parts)
        if (!rows.length) parts.push(text('暂无记录'))
      } else if (v.screen === 'source') {
        back('返回全部资料', 'sources')
        parts.push(text(src.name), text(src.verified ? '已核对' : '待核对'))
        if (src.photo) {
          parts.push(buttons(['查看照片', 'photo']))
          if (src.error || !src.text)
            parts.push(
              text(src.error || '等待读图'),
              buttons(['重新识别', 'retry']),
            )
        }
        const chunks = src.segments || splitText(src.text),
          i = v.part || 0
        values.input = chunks[i]
        parts.push(
          form('保存本段核对', 'editSource', [
            field('提取内容 ' + (i + 1) + '/' + chunks.length, 'input', {
              multiline: true,
              maxLength: 1000,
            }),
          ]),
        )
        pageParts(parts, i, chunks.length)
      } else if (v.screen === 'photo') {
        back('返回提取内容', 'backSource')
        parts.push({
          type: 'image',
          src: preview(photoFile(src.id), v.tile ?? -1),
          alt: src.name,
        })
        parts.push(
          buttons(
            ...['左上', '右上', '左下', '右下'].map((label, tile) => [
              label,
              'tile',
              { tile },
            ]),
          ),
        )
      } else if (v.screen === 'note') {
        back('返回工作台', 'backCase')
        const i = v.part || 0
        parts.push(
          text(
            note.confirmed ? '已确认 · ' + note.time : '草稿 · ' + note.time,
          ),
        )
        if (note.issues.length)
          parts.push({
            type: 'callout',
            tone: 'warn',
            text: note.issues.join('\n').slice(0, 900),
          })
        parts.push(
          buttons(
            ['全部提取结果', 'sources'],
            ['逐段编辑', 'editNote', { part: i }],
          ),
        )
        parts.push(
          ...note.sections
            .slice((v.page || 0) * 8, (v.page || 0) * 8 + 8)
            .map(text),
        )
        paginate(
          note.sections.map((line, part) => ({
            title: '第' + (part + 1) + '段',
            subtitle: line.slice(0, 80),
            action: action('editNote', { part }),
          })),
          v.page,
          parts,
        )
        if (!note.confirmed) parts.push(buttons(['确认定稿', 'confirm']))
        else parts.push(buttons(['复制全文', 'copyAll']))
      } else if (v.screen === 'editNote') {
        back('返回草稿', 'backNote')
        const i = v.part || 0
        values.input = note.sections[i]
        parts.push(text('第' + (i + 1) + '/' + note.sections.length + '段'))
        if (note.confirmed)
          parts.push(text(values.input), buttons(['复制本段', 'copyPart']))
        else
          parts.push(
            form('保存本段', 'savePart', [
              field('正文', 'input', {
                required: true,
                multiline: true,
                maxLines: 8,
                maxLength: 1100,
              }),
            ]),
          )
        pageParts(parts, i, note.sections.length)
      }
    }
    // Associate every tap and submission with the view it came from.
    const token = v.token || 'root'
    function stamp(node) {
      if (node.action) node.action.args.token = token
      if (node.submit) node.submit = action(node.submit, { token })
      for (const child of [...(node.children || []), ...(node.items || [])])
        stamp(child)
    }
    const view = { v: 2, type: 'stack', children: parts }
    stamp(view)
    return { view, form: values }
  }
  function pageParts(parts, i, length) {
    const nav = []
    if (i > 0) nav.push(['上一段', 'part', { part: i - 1 }])
    if (i + 1 < length) nav.push(['下一段', 'part', { part: i + 1 }])
    if (nav.length) parts.push(buttons(...nav))
  }
  function job(id, label, work) {
    if (jobs.get(id)?.running) throw Error('正在处理，请稍后查看')
    const status = { message: label, running: true }
    jobs.set(id, status)
    Promise.resolve()
      .then(work)
      .then((msg) => (status.message = msg))
      .catch((e) => {
        status.message = '未完成：' + String(e.message).slice(0, 140)
      })
      .finally(() => (status.running = false))
    return { refresh: true }
  }
  async function ocr(id, ids) {
    for (const sid of ids) {
      try {
        const output = await recognize(photoFile(sid), dir)
        store().change(id, (c) => {
          const a = c.sources.find((x) => x.id === sid)
          if (!a.verified) {
            a.text = output
            delete a.segments
            delete a.reviewed
            a.error = ''
          }
        })
      } catch (error) {
        store().change(id, (c) => {
          c.sources.find((x) => x.id === sid).error =
            '识别失败，请重试或手动录入'
        })
      }
    }
    return '照片已处理，在当日资料中核对'
  }
  async function handle(id, s, event) {
    const a = event.value || {},
      { v, c, note, src } = current(s),
      day = v.day || today()
    const nav = (screen, extra = {}) =>
      go(s, { ...v, screen, page: 0, part: 0, ...extra })
    if (id === 'received') {
      const dest = picks.get(key(s))
      picks.delete(key(s))
      if (!dest || a.status !== 'selected') return { toast: '未添加照片' }
      if (dest.token !== v.token || c?.id !== dest.id || c.archived)
        throw Error('患者页面已改变，请重新选图')
      if (jobs.get(c.id)?.running) throw Error('正在处理，请稍后添加')
      mkdirSync(join(dir, 'photos'), { recursive: true, mode: 0o700 })
      const added = []
      for (const f of a.files) {
        const bytes = Buffer.from(await ctx.dshGo.readPickedFile(f.handle))
        const jpg = bytes[0] === 255 && bytes[1] === 216,
          png = bytes
            .subarray(0, 8)
            .equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        if (!jpg && !png) throw Error('请使用 JPEG 或 PNG 照片')
        added.push({
          id: randomUUID(),
          name: f.name || '照片',
          day: dest.day,
          photo: true,
          verified: false,
          text: '',
          bytes,
        })
      }
      for (const item of added) {
        writeFileSync(photoFile(item.id), item.bytes, { mode: 0o600 })
        delete item.bytes
      }
      store().change(dest.id, (p) => p.sources.push(...added))
      return job(dest.id, '正在识别照片', () =>
        ocr(
          dest.id,
          added.map((x) => x.id),
        ),
      )
    }
    if (a.token !== (v.token || 'root')) throw Error('页面已经更新，请重新打开')
    const val = (k) => a.values?.['data.form.' + k]
    switch (id) {
      case 'home':
        return go(s, { screen: 'list' })
      case 'archiveList':
        return nav('list', { archived: !v.archived })
      case 'newCase':
        return nav('new')
      case 'create':
        return go(s, {
          screen: 'case',
          day: today(),
          id: store().create({
            name: val('name'),
            bed: val('bed') || '',
            admission: val('admission'),
            entry: val('entry'),
          }),
        })
      case 'case':
        return go(s, { screen: 'case', id: a.id, day: today() })
      case 'page':
        return nav(v.screen, { page: a.page })
      case 'part':
        return nav(v.screen, { part: a.part })
      case 'backCase':
        return nav('case')
      case 'reload': {
        const ready = jobs.get(c.id)?.note
        return ready
          ? nav('note', {
              note: ready,
              day: c.notes.find((n) => n.id === ready).day,
            })
          : nav('case')
      }
      case 'sources':
        return nav(id, {
          sourceNote:
            v.screen === 'note'
              ? note.id
              : v.screen === 'source'
                ? v.sourceNote
                : null,
        })
      case 'settings':
      case 'history':
      case 'photo':
        return nav(id)
      case 'source':
        return nav('source', { src: a.src })
      case 'backSource':
        return nav('source')
      case 'tile':
        return nav('photo', { tile: a.tile })
      case 'note':
        return nav('note', {
          note: a.note,
          day: c.notes.find((n) => n.id === a.note).day,
        })
      case 'editNote':
        return nav('editNote', { part: a.part })
      case 'backNote':
        return nav('note')
      case 'day': {
        const d = val('day')
        if (!d || d < c.entry || d > today())
          throw Error('请选择入科至今天之间的日期')
        return nav('case', { day: d })
      }
      case 'bed':
        store().change(c.id, (p) => (p.bed = val('bed') || ''))
        return nav('case')
      case 'archive':
        store().change(c.id, (p) => (p.archived = !p.archived))
        return go(s, { screen: 'list' })
      case 'addText': {
        if (!val('input')?.trim() || c.archived)
          throw Error('请填写补充今日病情')
        store().change(c.id, (p) =>
          p.sources.push({
            id: randomUUID(),
            day,
            name: '医生补充',
            verified: true,
            text: val('input').trim(),
          }),
        )
        return nav('case')
      }
      case 'pick':
        picks.set(key(s), { id: c.id, day, token: v.token })
        return { type: 'pickImage', action: 'received', maxFiles: 4 }
      case 'retry':
        return job(c.id, '重新识别中', () => ocr(c.id, [src.id]))
      case 'editSource': {
        store().change(c.id, (p) => {
          const item = p.sources.find((x) => x.id === src.id),
            chunks = item.segments || splitText(item.text)
          chunks[v.part || 0] = val('input') || ''
          item.segments = chunks
          item.reviewed = [...new Set([...(item.reviewed || []), v.part || 0])]
          item.text = chunks.join('')
          item.verified = item.reviewed.length === chunks.length
          item.error = ''
        })
        return nav('sources')
      }
      case 'generate': {
        const task = {
          id: randomUUID(),
          kind: val('kind'),
          doctor: val('doctor') || '',
          period: val('period'),
          day,
          time: day + ' ' + val('clock'),
        }
        if (
          c.archived ||
          !kinds.includes(task.kind) ||
          !/^\d{2}:\d{2}$/.test(val('clock'))
        )
          throw Error('请核对文书类型和记录时间')
        if (task.kind === kinds[0] && !task.doctor.trim())
          throw Error('请填写查房医师及职称')
        return job(c.id, '正在生成，稍后点查看进度或草稿', async () => {
          const draft = await generate(
            ctx,
            c,
            task,
            AbortSignal.timeout(180000),
          )
          store().change(c.id, (p) => {
            p.notes.push({
              ...task,
              ...draft,
              sourceIds: c.sources
                .filter((s) => s.day === day)
                .map((s) => s.id),
              confirmed: false,
            })
            p.doctor = task.doctor
            p.lastKind = task.kind
          })
          jobs.get(c.id).note = task.id
          return '新草稿已就绪，请打开核对'
        })
      }
      case 'savePart':
      case 'confirm': {
        store().change(c.id, (p) => {
          const n = p.notes.find((x) => x.id === note.id)
          if (n.confirmed) throw Error('该记录已定稿')
          if (id === 'confirm') n.confirmed = true
          else if (val('input')?.trim())
            n.sections[v.part || 0] = val('input').trim()
          else throw Error('正文不能为空')
        })
        return nav('note')
      }
      case 'copyAll':
      case 'copyPart': {
        if (!note.confirmed) throw Error('请先核对并确认')
        const value =
          id === 'copyAll'
            ? note.sections.join('\n\n')
            : note.sections[v.part || 0]
        if (value.length > 8000) throw Error('全文超过宿主复制上限，请逐段复制')
        return { copy: value }
      }
    }
  }
  const ids =
    'home archiveList newCase create case page part backCase reload settings history sources source backSource tile photo note editNote backNote day bed archive addText pick received retry editSource generate savePart confirm copyAll copyPart'.split(
      ' ',
    )
  return {
    view: (s, caps) => display(s, caps).view,
    data: (s, emit) => {
      emit({ form: display(s).form })
      return () => {}
    },
    actions: Object.fromEntries(
      ids.map((id) => [
        id,
        async (s, e) => {
          try {
            return await handle(id, s, e)
          } catch (err) {
            return { toast: String(err.message).slice(0, 40) }
          }
        },
      ]),
    ),
  }
}
export const inject = { optional: ['llm', 'agentDefaultModel'] }
export function apply(ctx) {
  ctx.inject(['dshGo'], (host) => {
    const dir = join(
      process.env.DSH_HOME || join(homedir(), '.dsh'),
      'icu-workbench',
    )
    host.dshGo.panel('workbench', buildPanel(host, dir))
  })
}
