import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, today, days } from '../lib/store.js'
import { buildPanel } from '../lib/index.js'
import { generate, requestData, kinds } from '../lib/model.js'
import { recognize, preview } from '../lib/photo.js'
import { findEvidence } from '../lib/evidence.js'
const temp = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'icu-case-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  return d
}
const date = today(),
  fields = {
    name: '甲',
    bed: '01',
    admission: '2026-01-01',
    entry: '2026-01-02',
  }
const synthetic = {
  sections: ['模拟查房记录', '医生核定的计划［1］'],
  issues: ['待核对'],
}
const ctx = {
  llm: {
    prepareCall: async () => ({
      config: {},
      stream: async function* () {
        yield { type: 'text-delta', text: JSON.stringify(synthetic) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  },
  agentDefaultModel: {
    currentSelection: () => ({ provider: 'mock', model: 'test' }),
  },
}
test('病例、日期和已确认历史独立；事务失败回滚且重开可读', (t) => {
  const dir = temp(t),
    db = openStore(dir),
    a = db.create(fields),
    b = db.create({ ...fields, name: '乙' })
  db.change(a, (c) => {
    c.sources.push({ id: 'a', day: date, text: '今日观察' })
    c.notes.push(
      { time: '2026-01-02 08:00', confirmed: true, sections: ['旧病程'] },
      { time: '2026-01-02 13:00', confirmed: false, sections: ['未定稿'] },
    )
  })
  const input = requestData(db.get(a), { day: date, time: date + ' 08:00' })
  assert.deepEqual(
    input.已确认历史.map((x) => x.正文),
    [['旧病程']],
  )
  assert.equal(db.get(b).sources.length, 0)
  assert.equal(days('2026-01-02', '2026-01-03'), 2)
  assert.throws(() =>
    db.change(a, (c) => {
      c.name = '误改'
      throw Error('中止')
    }),
  )
  db.close()
  const renewed = openStore(dir)
  assert.equal(renewed.get(a).name, '甲')
  assert.equal(renewed.list().length, 2)
  renewed.close()
})
test('真实面板操作：建卡、录入、生成、编辑、定稿、复制、拒绝旧页面操作', async (t) => {
  const panel = buildPanel(ctx, temp(t)),
    scope = { sessionId: 'x' }
  const check = process.env.DSH_VIEW_CHECK
    ? (await import(process.env.DSH_VIEW_CHECK)).checkView
    : null
  const view = () => {
    const tree = panel.view(scope, { features: ['files'] })
    if (check) {
      const result = check(tree)
      assert.ok(
        result.ok && !result.placeholders && !result.truncated,
        JSON.stringify(result),
      )
    }
    return tree
  }
  function walk(node) {
    return [
      node,
      ...[...(node.children || []), ...(node.items || [])].flatMap(walk),
    ]
  }
  async function tap(id, values = {}) {
    const target = walk(view())
      .map((n) => n.action || n.submit)
      .find((a) => a?.id === id)
    assert.ok(target, '找不到 ' + id)
    const result = await panel.actions[id](scope, {
      value: {
        ...target.args,
        values: Object.fromEntries(
          Object.entries(values).map(([k, v]) => ['data.form.' + k, v]),
        ),
      },
    })
    assert.ok(!result.toast, result.toast)
    return result
  }
  await tap('newCase')
  await tap('create', fields)
  await tap('addText', { input: '医生已确认今日可以坐起。' })
  await tap('generate', {
    kind: kinds[0],
    doctor: '张三主任医师',
    period: '今晨',
    clock: '08:35',
  })
  for (
    let i = 0;
    i < 100 && !JSON.stringify(view()).includes('新草稿已就绪');
    i++
  )
    await new Promise((r) => setTimeout(r, 10))
  await tap('reload')
  await tap('editNote')
  await tap('savePart', { input: '医生已修改的标题' })
  await tap('confirm')
  assert.match((await tap('copyAll')).copy, /医生已修改的标题/)
  assert.ok(
    (await panel.actions.addText(scope, { value: { token: 'root' } })).toast,
  )
})
test('图片预览与真实中英文 OCR', async (t) => {
  const pic = new URL('../examples/虚构血气单.png', import.meta.url).pathname
  const path = decodeURIComponent(pic),
    dir = temp(t)
  assert.match(preview(path, -1), /^data:image\/jpeg;base64,/)
  assert.match(await recognize(path, dir), /7\.42/)
})
test('参考文献从实际检获的记录装配，查询只含固定主题', async () => {
  const urls = []
  const refs = await findEvidence(
    '患者姓名保密；脓毒症',
    new AbortController().signal,
    async (url) => {
      urls.push(String(url))
      return {
        ok: true,
        json: async () => ({ esearchresult: { idlist: ['123'] } }),
        text: async () =>
          '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>123</PMID><Article><ArticleTitle>Guideline</ArticleTitle><Abstract><AbstractText>Evidence</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>',
      }
    },
  )
  assert.match(refs[0][2], /123/)
  assert.ok(!decodeURIComponent(urls.join('')).includes('姓名'))
})
test('跨日草稿及同日加记保留历史；文献不可用时仍可起草', async (t) => {
  const db = openStore(temp(t)),
    id = db.create(fields)
  db.change(id, (c) => {
    c.sources.push(
      { id: 'old', day: '2026-01-02', text: '昨日在泵' },
      { id: 'new', day: '2026-01-03', text: '今晨停泵' },
    )
    c.notes.push(
      {
        confirmed: true,
        day: '2026-01-02',
        time: '2026-01-02 08:35',
        sections: ['晨间定稿'],
      },
      {
        confirmed: true,
        day: '2026-01-02',
        time: '2026-01-02 15:30',
        sections: ['病情变化加记'],
      },
    )
  })
  const c = db.get(id),
    task = { kind: kinds[1], day: '2026-01-03', time: '2026-01-03 08:35' }
  assert.deepEqual(
    requestData(c, task).当日资料.map((x) => x.id),
    ['new'],
  )
  assert.equal(requestData(c, task).已确认历史.length, 2)
  const n = await generate(
    ctx,
    c,
    task,
    new AbortController().signal,
    async () => {
      throw Error('offline')
    },
  )
  assert.match(n.sections.at(-1), /10.4187/)
  assert.match(n.issues.at(-1), /检索未完成/)
  db.close()
})
test('没有模型服务时工作台仍可打开；生成给出明确提示', async (t) => {
  const panel = buildPanel({}, temp(t)),
    scope = { sessionId: 'no-model' }
  function walk(node) {
    return [
      node,
      ...[...(node.children || []), ...(node.items || [])].flatMap(walk),
    ]
  }
  async function tap(id, values = {}) {
    const target = walk(panel.view(scope, { features: [] }))
      .map((n) => n.action || n.submit)
      .find((a) => a?.id === id)
    assert.ok(target, '找不到 ' + id)
    return panel.actions[id](scope, {
      value: {
        ...target.args,
        values: Object.fromEntries(
          Object.entries(values).map(([k, v]) => ['data.form.' + k, v]),
        ),
      },
    })
  }
  await tap('newCase')
  await tap('create', fields)
  assert.match(JSON.stringify(panel.view(scope, { features: [] })), /未检测到 DSH 默认模型/)
  const result = await tap('generate', {
    kind: kinds[0],
    doctor: '张三主任医师',
    period: '今晨',
    clock: '08:35',
  })
  assert.match(result.toast, /选择默认模型/)
})
test('清单提供聊天胶囊与会话操作两个明确入口', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  const panel = pkg.dshGo.contributes.panels.find((p) => p.id === 'workbench')
  assert.deepEqual(panel.placement, ['session.tab', 'features', 'chat.panel'])
  const composer = pkg.dshGo.contributes['composer.actions']
  assert.equal(composer.length, 1)
  assert.equal(composer[0].label, 'ICU 病历')
  assert.equal(composer[0].effect.page, 'panel:workbench')
  const session = pkg.dshGo.contributes['session.actions']
  assert.equal(session.length, 1)
  assert.equal(session[0].label, 'ICU 病历工作台')
  assert.equal(session[0].effect.page, 'panel:workbench')
})
