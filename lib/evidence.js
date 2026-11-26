import { XMLParser } from 'fast-xml-parser'

const topics = [
  [/脓毒|感染性休克/, 'sepsis'],
  [/机械通气|脱机|拔管/, 'ventilator liberation'],
  [/CRRT|急性肾损伤/i, 'acute kidney injury'],
  [/肺炎/, 'pneumonia'],
  [/镇静|谵妄/, 'intensive care sedation'],
  [/肠内营养/, 'critical care nutrition'],
]
const asList = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value]
const plain = (value) =>
  typeof value === 'object'
    ? Object.values(value).map(plain).join(' ')
    : String(value ?? '')
export async function findEvidence(material, signal, request = fetch) {
  const topic = topics.find(([pattern]) => pattern.test(material))?.[1]
  if (!topic) return []
  // Only pre-defined topic terms go to PubMed. Patient text stays with the configured model.
  const query = new URLSearchParams({
    db: 'pubmed',
    retmode: 'json',
    retmax: '2',
    sort: 'pub date',
    term:
      topic +
      ' AND (guideline[pt] OR practice guideline[pt] OR consensus[ti]) AND hasabstract AND english[lang]',
  })
  const root = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(7000)])
  const res = await request(root + 'esearch.fcgi?' + query, { signal: bounded })
  if (!res.ok) throw Error('PubMed 检索暂不可用')
  const ids = (await res.json()).esearchresult.idlist.filter((id) =>
    /^\d+$/.test(id),
  )
  if (!ids.length) return []
  const records = await request(
    root + 'efetch.fcgi?db=pubmed&retmode=xml&id=' + ids.join(','),
    { signal: bounded },
  )
  if (!records.ok) throw Error('PubMed 摘要暂不可用')
  const result = new XMLParser({ parseTagValue: false }).parse(
    await records.text(),
  )
  return asList(result.PubmedArticleSet?.PubmedArticle).flatMap((row) => {
    const citation = row.MedlineCitation,
      article = citation?.Article
    if (!article || !ids.includes(citation.PMID)) return []
    const abstract = asList(article.Abstract?.AbstractText).map(plain).join(' ')
    if (!abstract) return []
    return [
      [
        plain(article.ArticleTitle) +
          ' (' +
          plain(article.Journal?.JournalIssue?.PubDate?.Year) +
          ')',
        abstract.slice(0, 4800),
        'https://pubmed.ncbi.nlm.nih.gov/' + citation.PMID + '/',
      ],
    ]
  })
}
