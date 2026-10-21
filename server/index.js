import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const PDFDocument = require('pdfkit');
// 中文 PDF 字体：随仓库携带（server/fonts/simhei.ttf），跨平台可用（Windows/Linux）
const FONT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts', 'simhei.ttf');
// 纯 WASM 音频解码器（无本机二进制依赖）：mp3 / m4a-aac / flac / ogg-opus
const { MPEGDecoder } = require('mpg123-decoder');
const { AACDecoder } = require('@wasm-audio-decoders/aac');
const { FLACDecoder } = require('@wasm-audio-decoders/flac');
const { OggOpusDecoder } = require('ogg-opus-decoder');

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const BASE_URL = 'https://api.deepseek.com';

// 讯飞录音文件转写大模型凭据（功能4 使用；未配置时可用转录文本兜底）
// 三件套鉴权：AppID / APIKey / APISecret（控制台服务页面获取）
const XF_APP_ID = process.env.XF_APP_ID || '';
const XF_API_KEY = process.env.XF_API_KEY || '';
const XF_APISECRET = process.env.XF_APISECRET || '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!API_KEY) {
  console.error('未配置 DEEPSEEK_API_KEY，请检查 server/.env（可参照 .env.example）');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// 根路由：便于云平台健康检查/排查（Koyeb 等平台部署后可直接访问确认服务在线）
app.get('/', (req, res) => res.json({ ok: true, service: 'hr-agent-api', time: new Date().toISOString() }));

/** 判断是否为招聘职位页（优先 BOSS 直聘职位详情/列表；排除投资者关系、政务、社区、PDF 等页面） */
function isJobPageUrl(url) {
  if (!url) return false;
  // 明确排除的 zhipin 非职位页面
  if (/youle\.zhipin\.com|ir\.zhipin\.com|sdwj\.zhipin\.com|bzl-office|pdf-viewer|aboutUs/.test(url)) return false;
  if (url.includes('zhipin.com')) {
    return /zhipin\.com\/(job_detail|zhaopin|job)\//.test(url);
  }
  if (url.includes('liepin.com')) return /liepin\.com\/job\//.test(url);
  if (url.includes('51job.com')) return /jobs\.51job\.com/.test(url);
  return false;
}

/** 多 query 轮询收集候选：内容含目标岗位的候选优先，BOSS 直聘 > 猎聘 > 51job 兜底 */
async function collectCandidates(city, job) {
  const seen = new Set();
  const out = [];
  const push = (list) => {
    for (const r of list || []) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push(r);
    }
  };

  const queries = [
    `site:zhipin.com ${city} ${job}`,
    `site:m.zhipin.com ${city} ${job}`,
    `site:www.zhipin.com ${city} ${job}`,
    `site:liepin.com ${city} ${job}`,
    `site:51job.com ${city} ${job}`,
  ];
  for (const q of queries) {
    try {
      push(await deepseekSearch(q, `查找${city}的${job}岗位最新发布的招聘信息`));
    } catch (e) {
      console.warn('[census] 搜索失败:', q, e.message);
    }
  }

  // 排序：内容含目标岗位名的候选提前；同相关度下按 站点优先级（zhipin > liepin > 51job）
  const score = (r) => {
    const u = r.url || '';
    let s = 0;
    if (/zhipin\.com\/(job_detail|zhaopin|job)\//.test(u)) s = 0;
    else if (/liepin\.com\/job\//.test(u)) s = 1;
    else if (/jobs\.51job\.com/.test(u)) s = 2;
    else s = 3;
    const text = `${r.title || ''} ${r.snippet || ''} ${r.content || ''}`;
    if (text.includes(job)) s -= 2;
    return s;
  };
  return out.filter((r) => isJobPageUrl(r.url)).sort((a, b) => score(a) - score(b)).slice(0, 15);
}

/** 后端强制相关性过滤：job 必须与查询岗位语义相关 */
function isJobRelated(job, queryJob) {
  if (!job || job === '未知') return false;
  const j = job.toLowerCase().trim();
  const q = queryJob.toLowerCase().trim();
  if (!q) return false;
  if (j.includes(q) || q.includes(j)) return true;
  // 提取查询岗位的核心词（去除常见后缀）再匹配
  const core = q.replace(/(工程师|开发工程师|经理|专员|设计师|运营|开发|主管|助理|总监)$/, '');
  return core.length >= 2 && j.includes(core);
}

/** 调用 DeepSeek 官方 Search API */
async function deepseekSearch(query, oriQuestion) {
  const res = await fetch(`${BASE_URL}/v1/tools/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      query,
      count: 20,
      ori_question: oriQuestion,
      need_content: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Search 请求失败: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.results || [];
}

/** 调用 DeepSeek Responses API，让模型把搜索结果整理为结构化 JSON */
async function summarizeWithModel(job, city, results) {
  const truncated = results.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: (r.snippet || '').slice(0, 500),
    content: (r.content || '').slice(0, 1200),
    date: r.date || null,
    site_name: r.site_name || '',
  }));

  const instructions = `你是招聘信息整理助手。用户会提供一批搜索结果（字段：title/url/snippet/content/date/site_name，主要来自 BOSS 直聘等招聘网站）。
请严格筛选：
1. 只保留真实的招聘信息（岗位招聘、职位发布），忽略与招聘无关的内容（公司公告、招股书、财务报表、新闻报道、社区问答、攻略文章、PDF 文档等）。
2. 内容必须与目标城市相关（公司所在地或职位描述体现该城市）。
3. 相关性过滤：只保留与目标岗位语义相关的职位。例如查询"产品经理"时，出现"Java开发工程师""汽车销售专员"等明显不相关的岗位，必须丢弃该条目。
4. 关键：搜索结果的 title 字段常常只是薪资数字（如"11-12K"），不是岗位名称。真正的岗位名称要从 content 或 snippet 的"职位描述"部分提取（例如"前端开发工程师""汽车销售专员"）。"job" 字段必须是从职位描述中提取的具体岗位名称；若职位描述缺失或无法确认岗位，直接丢弃该条目。
5. 来源优先：优先采用 BOSS 直聘（zhipin.com）的职位；若 BOSS 直聘有效职位不足 10 条，用其他招聘网站（猎聘、51job 等）的职位补齐到 10 条（或全部可用条数），并在 sourceSite 字段如实标注来源站点。
筛选通过后，整理成「最新发布的 10 条」（优先依据 date 或内容中出现的发布时间，选取最新；不足 10 条则有多少整理多少，不得编造）。
只输出一个严格的 JSON 数组，不要输出任何解释、前言或 Markdown 代码块标记。
数组每项格式为：{"job":"岗位名称","company":"公司名称","salary":"薪资","publishDate":"发布时间","city":"城市","sourceUrl":"原始链接","sourceSite":"来源站点","education":"学历要求（博士/硕士/本科/大专/学历不限/未知）","workSchedule":"工作制度（双休/单休/大小周/弹性/未知）","experience":"经验要求（不限/应届/1-3年/3-5年/5-10年/10年以上/未知）","companyScale":"公司规模（如 1000-9999人，无法确定填未知）"}。
education/workSchedule/experience/companyScale 请从职位描述或公司信息中提取，无法确定时填"未知"；不要编造。
无法从材料中确定的字段填"未知"；sourceUrl 必须原样使用搜索结果中的 url。`;

  const res = await fetch(`${BASE_URL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      reasoning: { effort: 'none' },
      instructions,
      input: [
        {
          role: 'user',
          content: `岗位：${job}\n城市：${city}\n\n搜索结果：\n${JSON.stringify(truncated, null, 2)}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek 整理失败: HTTP ${res.status}`);
  }
  const data = await res.json();
  const text =
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text ||
    data.output?.[0]?.content ||
    '';
  return parseJsonArray(text);
}

/** 从模型输出中提取 JSON 数组（兼容 ```json 包裹等情况） */
function parseJsonArray(text) {
  if (!text) return null;
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** 薪资解析：提取月薪区间（K 为单位），非月薪/面议返回 null */
function parseSalary(s) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  if (/面议|未知|元\/天|日薪|小时|年薪|千元/.test(t)) return null;
  const range = t.match(/(\d+(?:\.\d+)?)\s*[-~—至]+\s*(\d+(?:\.\d+)?)\s*K/i);
  if (range) return { min: +range[1], max: +range[2] };
  const single = t.match(/(\d+(?:\.\d+)?)\s*K/i);
  if (single) return { min: +single[1], max: +single[1] };
  return null;
}

/** 学历等级映射（值越大要求越高） */
const EDU_LEVEL = { 博士: 5, 硕士: 4, 本科: 3, 大专: 2, 高中: 1, 中专: 1, 初中: 1, '高中及以下': 1 };
const EDU_LEVEL_NAME = ['', '高中及以下', '大专', '本科', '硕士', '博士'];

/** 薪资统计：最高/最低/平均 */
function summarizeSalary(items) {
  const vals = [];
  for (const it of items) {
    const p = parseSalary(it.salary);
    if (p) vals.push(p);
  }
  if (!vals.length) {
    return { highest: '未知', lowest: '未知', average: '未知', validCount: 0, unit: 'K/月' };
  }
  const highest = Math.max(...vals.map((v) => v.max));
  const lowest = Math.min(...vals.map((v) => v.min));
  const average = Math.round((vals.reduce((s, v) => s + (v.min + v.max) / 2, 0) / vals.length) * 10) / 10;
  return { highest, lowest, average, validCount: vals.length, unit: 'K/月' };
}

/** 学历统计：最高/最低/平均要求 + 分布 */
function summarizeEducation(items) {
  const counts = {};
  const levels = [];
  for (const it of items) {
    const e = (it.education || '未知').trim() || '未知';
    counts[e] = (counts[e] || 0) + 1;
    const lv = EDU_LEVEL[e];
    if (lv) levels.push(lv);
  }
  const distribution = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  let highest = '未知', lowest = '未知', average = '未知';
  if (levels.length) {
    const maxLv = Math.max(...levels);
    const minLv = Math.min(...levels);
    const avgLv = levels.reduce((s, lv) => s + lv, 0) / levels.length;
    highest = EDU_LEVEL_NAME[maxLv];
    lowest = EDU_LEVEL_NAME[minLv];
    average = EDU_LEVEL_NAME[Math.round(avgLv)];
  }
  return { highest, lowest, average, distribution };
}

/** 按分组统计计数（匹配最长的组优先） */
function countBy(items, key, groups) {
  const counts = {};
  for (const g of groups) counts[g] = 0;
  counts['未知'] = 0;
  const sorted = [...groups].sort((a, b) => b.length - a.length);
  for (const it of items) {
    const v = (it[key] || '未知').trim() || '未知';
    let matched = null;
    for (const g of sorted) if (v.includes(g)) { matched = g; break; }
    counts[matched || '未知'] += 1;
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count }));
}

/** 发布时效统计（相对当前时间） */
function summarizeRecency(items, now = new Date()) {
  const buckets = { '近7天': 0, '近30天': 0, '30天以上': 0, 未知: 0 };
  for (const it of items) {
    const d = it.publishDate || '';
    const m = String(d).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!m) { buckets['未知'] += 1; continue; }
    const date = new Date(+m[1], +m[2] - 1, +m[3]);
    const days = (now - date) / 86400000;
    if (days <= 7) buckets['近7天'] += 1;
    else if (days <= 30) buckets['近30天'] += 1;
    else buckets['30天以上'] += 1;
  }
  return Object.entries(buckets).map(([name, count]) => ({ name, count }));
}

/** 汇总岗位市场分析 */
function buildSummary(items) {
  return {
    salary: summarizeSalary(items),
    education: summarizeEducation(items),
    workSchedule: countBy(items, 'workSchedule', ['双休', '单休', '大小周', '弹性']),
    experience: countBy(items, 'experience', ['不限', '应届', '1-3年', '3-5年', '5-10年', '10年以上']),
    companyScale: countBy(items, 'companyScale', ['0-20人', '20-99人', '100-499人', '500-999人', '1000-9999人', '10000人以上']),
    publishRecency: summarizeRecency(items),
  };
}

/** 岗位普查：搜索 + 大模型整理 */
app.post('/api/census', async (req, res) => {
  const { job, city } = req.body || {};
  if (!job || !city) {
    return res.status(400).json({ error: '岗位名称和城市不能为空' });
  }
  try {
    // 多 query 轮询收集候选（优先 BOSS 直聘职位页）
    const ordered = await collectCandidates(city, job);
    if (!ordered.length) {
      return res.status(404).json({ error: '未搜索到相关招聘信息，请尝试调整岗位名称或城市' });
    }

    const zhipin = ordered.filter((r) => r.url.includes('zhipin.com'));

    let items = null;
    try {
      items = await summarizeWithModel(job, city, ordered);
    } catch (e) {
      console.warn('[census] 模型整理失败，退回搜索结果:', e.message);
    }

    if (!Array.isArray(items) || items.length === 0) {
      // 兜底：直接用搜索结果构成条目（同样经过相关性过滤）
      items = ordered.slice(0, 10).map((r) => ({
        job: r.title || '未知',
        company: '未知',
        salary: '',
        publishDate: r.date || '未知',
        city,
        sourceUrl: r.url,
        sourceSite: r.site_name || 'BOSS直聘',
      }));
    }

    // 后端强制相关性过滤：不相关岗位一律丢弃，保证输出真实相关
    items = (Array.isArray(items) ? items : []).filter((it) => isJobRelated(it.job, job));
    if (!items.length) {
      return res.json({
        items: [],
        total: ordered.length,
        bossCount: zhipin.length,
        fromModel: true,
        notice: `未在公开搜索结果中找到与「${job}」匹配的职位信息，建议在 BOSS 直聘官网直接搜索确认。`,
      });
    }

    res.json({
      items: items.slice(0, 10),
      total: ordered.length,
      bossCount: zhipin.length,
      fromModel: true,
      summary: buildSummary(items.slice(0, 10)),
    });
  } catch (e) {
    console.error('[census] 查询失败:', e.message);
    res.status(500).json({ error: `查询失败：${e.message}` });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, model: MODEL });
});

// ---------- 功能2：简历筛选 ----------

// 简历文件仅存内存处理，不落盘
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 20, fileSize: 10 * 1024 * 1024 },
});

// ---------- 功能3：面试准备 ----------

// 最近筛选简历的内存缓存（文件名 -> 简历文本与元信息；进程重启即清，不落盘）
const resumeCache = new Map();
const RESUME_CACHE_MAX = 100;
function setResumeCache(fileName, entry) {
  resumeCache.set(fileName, entry);
  if (resumeCache.size > RESUME_CACHE_MAX) {
    const oldest = resumeCache.keys().next().value;
    resumeCache.delete(oldest);
  }
}

/** 单份简历分析：调用 DeepSeek 输出结构化评估 */
async function analyzeResume(fileInfo, requirements) {
  const text = (fileInfo.text || '').slice(0, 8000);
  if (!text.trim()) {
    return {
      name: fileInfo.originalname.replace(/\.pdf$/i, ''),
      authenticity: 'PDF 无法解析出文本（可能为扫描件），请人工查看原简历',
      weaknesses: '无法评估',
      highlights: '无法评估',
      score: null,
      fileName: fileInfo.originalname,
      parseError: true,
    };
  }

  const instructions = `你是资深 HR 招聘专家，负责简历初筛。用户会提供一份岗位筛选要求和一份候选人简历文本。请客观分析简历，只输出一个严格的 JSON 对象（不要 Markdown 代码块、不要任何额外文字）：
{
  "name": "候选人姓名（从简历中提取，无法确定填"未知"）",
  "authenticity": "真实性判断：检查简历是否存在明显漏洞或虚假信息（如时间线矛盾、工作经历逻辑不符、学历或经历夸大造假迹象等）。无问题写"未发现明显虚假信息"；有问题则具体指出疑点。",
  "weaknesses": "简历的缺点或与岗位要求不匹配的点（具体分条列出，确实没有则写"无明显短板"）",
  "highlights": "简历的亮点（具体分条列出，确实没有则写"无明显亮点"）",
  "score": 0到100的整数综合评分
}
评分参考：与岗位要求匹配度约 60% 权重（城市、职位、薪资期望、学历、其他要求），简历质量与亮点约 40% 权重（经历真实性、项目深度、成长性）。
只根据简历实际内容分析，不要编造简历中不存在的信息；无法判断的维度如实说明。`;

  const res = await fetch(`${BASE_URL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      reasoning: { effort: 'none' },
      instructions,
      input: [
        {
          role: 'user',
          content: `【岗位筛选要求】\n职位：${requirements.job}\n城市：${requirements.city}\n薪资期望：${requirements.salary}\n学历要求：${requirements.education}\n其他要求：${requirements.other || '无'}\n\n【候选人简历文本】\n${text}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek 简历分析失败: HTTP ${res.status}`);
  }
  const data = await res.json();
  const raw =
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text ||
    data.output?.[0]?.content ||
    '';
  const parsed = (parseJsonArray(raw) || [])[0] || {};
  return {
    name: parsed.name || '未知',
    authenticity: parsed.authenticity || '未返回',
    weaknesses: parsed.weaknesses || '未返回',
    highlights: parsed.highlights || '未返回',
    score: typeof parsed.score === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.score))) : null,
    fileName: fileInfo.originalname,
  };
}

/** multer 对非 ASCII 文件名按 latin1 解码，这里转回 UTF-8 */
function fixFileName(name) {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

app.post('/api/resume-screening', upload.array('resumes', 20), async (req, res) => {
  const { city, job, salary, education, other } = req.body || {};
  const files = req.files || [];
  if (!city || !job) {
    return res.status(400).json({ error: '城市和职位名称不能为空' });
  }
  if (!files.length) {
    return res.status(400).json({ error: '请至少上传一份简历' });
  }
  if (files.length > 20) {
    return res.status(400).json({ error: '一次最多上传 20 个文件' });
  }
  const notPdf = files.filter((f) => !(f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname)));
  if (notPdf.length) {
    return res.status(400).json({ error: `仅支持 PDF 格式：${notPdf.map((f) => fixFileName(f.originalname)).join('、')}` });
  }

  const requirements = { city, job, salary: salary || '不限', education: education || '不限', other: other || '' };

  // 逐份提取 PDF 文本
  const parsed = [];
  for (const f of files) {
    const name = fixFileName(f.originalname);
    try {
      const result = await pdfParse(f.buffer);
      parsed.push({ originalname: name, text: result.text || '' });
    } catch (e) {
      console.warn('[resume] PDF 解析失败:', name, e.message);
      parsed.push({ originalname: name, text: '', parseFailed: true });
    }
  }

  // 分批并发分析（每批 5 份），降低瞬时并发压力
  const items = [];
  const BATCH = 5;
  for (let i = 0; i < parsed.length; i += BATCH) {
    const batch = parsed.slice(i, i + BATCH);
    const batchItems = await Promise.all(
      batch.map((p) => analyzeResume(p, requirements).catch((e) => ({
        name: p.originalname.replace(/\.pdf$/i, ''),
        authenticity: `分析失败：${e.message}`,
        weaknesses: '无法评估',
        highlights: '无法评估',
        score: null,
        fileName: p.originalname,
        error: true,
      })))
    );
    items.push(...batchItems);
  }

  // 评分从高到低排序；无评分（解析/分析失败）的排最后
  items.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  // 写入面试准备缓存（仅内存，供功能3按简历名取用）
  for (const p of parsed) {
    const item = items.find((i) => i.fileName === p.originalname);
    setResumeCache(p.originalname, {
      text: p.text,
      name: item?.name || p.originalname.replace(/\.pdf$/i, ''),
      score: item?.score ?? null,
      job,
      city,
      salary: requirements.salary,
      education: requirements.education,
      other: requirements.other,
      ts: Date.now(),
    });
  }

  res.json({ items, count: items.length });
});

// ---------- 功能3：面试准备 ----------

/** 生成面试问题：调用 DeepSeek 输出 6-8 个问题 JSON */
async function generateInterviewQuestions(cached, specialNeed) {
  const text = (cached.text || '').slice(0, 8000);
  const instructions = `你是资深 HR 面试官。请根据候选人简历和岗位信息，设计 6-8 个有针对性的面试问题。问题应：
1) 结合简历亮点深挖（项目细节、技术方案、量化成果）；
2) 针对简历疑点设计核实问题（如时间线矛盾、经历夸大、无法验证的描述）；
3) 考察与岗位要求（${cached.job}，城市 ${cached.city}）的匹配度与胜任力；
4) 考察职业稳定性、沟通与团队协作等软素质。
如用户提供了特别需求，问题必须覆盖特别需求。
只输出一个严格的 JSON 数组，不要输出任何其他文字或 Markdown 标记。数组每项格式：{"q":"面试问题内容","intent":"考察意图（一句话说明问这个问题的原因）"}。`;

  const res = await fetch(`${BASE_URL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      reasoning: { effort: 'none' },
      instructions,
      input: [
        {
          role: 'user',
          content: `【岗位信息】${cached.job}（城市：${cached.city}）\n【特别需求】${specialNeed || '无'}\n\n【候选人简历】\n${text}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek 面试问题生成失败: HTTP ${res.status}`);
  }
  const data = await res.json();
  const raw =
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text ||
    data.output?.[0]?.content ||
    '';
  const parsed = parseJsonArray(raw) || [];
  return parsed.filter((x) => x && x.q).map((x) => ({ q: String(x.q), intent: String(x.intent || '') }));
}

app.post('/api/interview-prep', async (req, res) => {
  const { fileName, specialNeed } = req.body || {};
  if (!fileName) {
    return res.status(400).json({ error: '请选择一份简历' });
  }
  const cached = resumeCache.get(fileName);
  if (!cached) {
    return res.status(404).json({ error: '未找到该简历的筛选记录，请先在「简历筛选」中上传简历打分' });
  }
  try {
    const questions = await generateInterviewQuestions(cached, specialNeed);
    if (!questions.length) {
      return res.status(502).json({ error: '大模型未返回有效的面试问题，请重试' });
    }
    res.json({
      fileName,
      name: cached.name,
      job: cached.job,
      city: cached.city,
      score: cached.score,
      questions: questions.slice(0, 8),
    });
  } catch (e) {
    console.error('[interview-prep] 生成失败:', e.message);
    res.status(500).json({ error: `生成失败：${e.message}` });
  }
});

/** 用 pdfkit 生成面试预提问 PDF */
function buildInterviewPdf({ fileName, job, city, specialNeed, questions }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fontPath = FONT_PATH;
      doc.registerFont('hei', fontPath);
      doc.font('hei');

      doc.fontSize(20).text('面试预提问清单', { align: 'center' });
      doc.moveDown(1.2);
      doc.fontSize(12).text(`候选人简历：${fileName}`);
      doc.text(`岗位信息：${job || '未知'}${city ? `（${city}）` : ''}`);
      doc.text(`特别需求：${specialNeed || '无'}`);
      doc.text(`生成日期：${new Date().toLocaleDateString('zh-CN')}`);
      doc.moveDown(1.2);

      (questions || []).forEach((q, i) => {
        doc.fontSize(12).text(`${i + 1}. ${q.q || q}`, { lineGap: 4 });
        if (q.intent) {
          doc.fontSize(10).text(`　考察意图：${q.intent}`, { indent: 14, lineGap: 6 });
        }
        doc.moveDown(0.6);
      });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

app.post('/api/interview-pdf', async (req, res) => {
  const { fileName, questions, specialNeed } = req.body || {};
  if (!fileName) {
    return res.status(400).json({ error: '缺少简历名' });
  }
  const cached = resumeCache.get(fileName);
  const qs = Array.isArray(questions) ? questions.filter((x) => x && x.q) : [];
  try {
    const pdf = await buildInterviewPdf({
      fileName,
      job: cached?.job,
      city: cached?.city,
      specialNeed: specialNeed || cached?.other,
      questions: qs,
    });
    const baseName = fileName.replace(/\.pdf$/i, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${baseName}-预提问.pdf`)}`);
    res.send(pdf);
  } catch (e) {
    console.error('[interview-pdf] 生成失败:', e.message);
    res.status(500).json({ error: `PDF 生成失败：${e.message}` });
  }
});

// ---------- 功能4：面试评分 ----------

/** 讯飞大模型版（Ifasr_llm / office-api-ist-dx）签名：
 * baseString = 除 signature 外的参数按 key 字典序排序，URL 编码后 key=value 用 & 连接（空值跳过）
 * signature = base64(HmacSHA1(baseString, APISecret))，放入请求头 signature
 */
function xfIfasrSignature(params, apiSecret) {
  const keys = Object.keys(params).sort();
  const parts = [];
  for (const k of keys) {
    const v = params[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  const baseString = parts.join('&');
  return crypto.createHmac('sha1', apiSecret).update(baseString).digest('base64');
}

/** 讯飞 dateTime 格式：yyyy-MM-dd'T'HH:mm:ss±HHmm（本地时间带时区偏移） */
function xfDateTime() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const offMin = -now.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** 讯飞 signatureRandom：16 位大小写字母+数字 */
function xfRandom16() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** URL 编码拼接查询参数 */
function buildQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** 解析讯飞大模型版转写结果 orderResult（JSON 字符串：lattice[].json_1best 为字符串；wp=g 分段）
 * 开启角色分离后按 rl 标注发言角色（如 [角色1] / [角色2]），便于大模型区分问答双方
 */
function parseXfIfasrResult(orderResult) {
  const segs = [];
  let cur = null;
  try {
    const data = JSON.parse(orderResult);
    const lattice = Array.isArray(data.lattice) ? data.lattice : [];
    for (const item of lattice) {
      if (!item || typeof item.json_1best !== 'string') continue;
      let best;
      try {
        best = JSON.parse(item.json_1best);
      } catch {
        continue;
      }
      const rl = best?.st?.rl || '0';
      let buf = '';
      const rt = best?.st?.rt || [];
      for (const r of rt) {
        const ws = r.ws || [];
        for (const w of ws) {
          for (const cw of w.cw || []) {
            if (cw.wp === 'g') buf += '\n';
            else if (cw.w) buf += cw.w;
          }
        }
      }
      if (!buf) continue;
      if (cur && cur.rl === rl) {
        cur.text += buf;
      } else {
        cur = { rl, text: buf };
        segs.push(cur);
      }
    }
  } catch (e) {
    console.warn('[asr] 解析转写结果失败:', e.message);
  }
  return segs.map((s) => `[角色${s.rl}] ${s.text.trim()}`).join('\n').trim();
}

/** 纯 JS/WASM 音频解码 → 16k/16bit/单声道 wav（不依赖本机任何二进制）
 * 支持格式：wav（PCM16/24/32、float32/64 手写解析）、mp3、m4a/aac、flac、ogg/opus
 * 流程：解码 → 声道混音 → 线性插值重采样 → 16bit PCM wav 编码，全程内存操作不落盘
 */
async function decodeAudioTo16kWav(buffer, fileName) {
  const ext = ((fileName || '').split('.').pop() || '').toLowerCase();
  let channelData = [];
  let sampleRate = 0;

  if (ext === 'wav' || ext === 'wave') {
    const parsed = parseWavPcm(buffer);
    channelData = parsed.channelData;
    sampleRate = parsed.sampleRate;
  } else {
    let Decoder = null;
    if (ext === 'mp3') Decoder = MPEGDecoder;
    else if (ext === 'm4a' || ext === 'aac' || ext === 'mp4') Decoder = AACDecoder;
    else if (ext === 'flac') Decoder = FLACDecoder;
    else if (ext === 'ogg' || ext === 'opus' || ext === 'oga') Decoder = OggOpusDecoder;
    else throw new Error(`暂不支持 .${ext || '未知'} 格式，请上传 wav/mp3/m4a/aac/flac/ogg 音频，或改用转录文本`);
    const decoder = new Decoder();
    try {
      await decoder.ready;
      const result = decoder.decode(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
      if (!result || !result.channelData || !result.channelData.length || !result.samplesDecoded) {
        throw new Error('音频解码失败，文件可能损坏或格式不符');
      }
      channelData = result.channelData;
      sampleRate = result.sampleRate;
    } finally {
      try {
        decoder.free();
      } catch {
        // ignore
      }
    }
  }

  if (!sampleRate || !channelData.length || !channelData[0].length) {
    throw new Error('音频解码失败，请检查文件是否为有效录音');
  }
  // 多声道混音为单声道
  const chCount = channelData.length;
  const len = Math.min(...channelData.map((c) => c.length));
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let c = 0; c < chCount; c++) sum += channelData[c][i];
    mono[i] = sum / chCount;
  }
  // 线性插值重采样到 16k
  const pcm16 = resampleLinear(mono, sampleRate, 16000);
  return encodeWav16(pcm16, 16000);
}

/** 解析 wav 为各声道 Float32 数据（支持 PCM16/24/32、float32/64；含 extensible 子格式） */
function parseWavPcm(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是有效的 WAV 文件');
  }
  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      const fmtData = offset + 8;
      audioFormat = buf.readUInt16LE(fmtData);
      channels = buf.readUInt16LE(fmtData + 2);
      sampleRate = buf.readUInt32LE(fmtData + 4);
      bitsPerSample = buf.readUInt16LE(fmtData + 14);
      if (audioFormat === 0xfffe && size >= 40) {
        audioFormat = buf.readUInt16LE(fmtData + 24); // extensible 子格式
      }
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0 || !channels || !sampleRate || !bitsPerSample) {
    throw new Error('WAV 文件缺少必要数据块');
  }
  // 部分工具（如流式 ffmpeg）把 data 大小写成 0xFFFFFFFF 表示未知，用实际剩余长度兜底
  const avail = buf.length - dataStart;
  if (dataSize > avail) dataSize = avail;
  if (dataSize <= 0) {
    throw new Error('WAV 文件没有音频数据');
  }
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`暂不支持该 WAV 编码（format=${audioFormat}），请转存为标准 PCM WAV 或 mp3`);
  }
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.floor(dataSize / (bytesPerSample * channels));
  const channelData = Array.from({ length: channels }, () => new Float32Array(sampleCount));
  for (let i = 0; i < sampleCount; i++) {
    for (let c = 0; c < channels; c++) {
      const p = dataStart + (i * channels + c) * bytesPerSample;
      if (audioFormat === 1) {
        if (bitsPerSample === 16) channelData[c][i] = buf.readInt16LE(p) / 32768;
        else if (bitsPerSample === 24) channelData[c][i] = buf.readIntLE(p, 3) / 8388608;
        else if (bitsPerSample === 32) channelData[c][i] = buf.readInt32LE(p) / 2147483648;
        else throw new Error(`暂不支持 ${bitsPerSample}bit 的 PCM WAV`);
      } else if (bitsPerSample === 32) {
        channelData[c][i] = buf.readFloatLE(p);
      } else if (bitsPerSample === 64) {
        channelData[c][i] = buf.readDoubleLE(p);
      } else {
        throw new Error(`暂不支持 ${bitsPerSample}bit 的浮点 WAV`);
      }
    }
  }
  return { channelData, sampleRate };
}

/** 线性插值重采样 */
function resampleLinear(mono, fromRate, toRate) {
  const len = mono.length;
  const outLen = Math.max(1, Math.round((len * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const step = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    if (i0 + 1 < len) out[i] = mono[i0] * (1 - frac) + mono[i0 + 1] * frac;
    else out[i] = mono[Math.min(i0, len - 1)];
  }
  return out;
}

/** 编码 16bit PCM 单声道 wav */
function encodeWav16(pcm, sampleRate) {
  const n = pcm.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = pcm[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

/** 讯飞录音文件转写大模型（Ifasr_llm）：转码 → 上传（/v2/upload）→ 轮询（/v2/getResult）
 * 轮询间隔 5s，上限约 3 分钟
 */
async function transcribeAudio({ buffer, fileName }) {
  if (!XF_APP_ID || !XF_API_KEY || !XF_APISECRET) {
    throw new Error('未配置讯飞转写凭据（server/.env 的 XF_APP_ID / XF_API_KEY / XF_APISECRET），请改用转录文本');
  }

  // 0. 纯 JS/WASM 解码并转成 16k/16bit/单声道 wav（wav/mp3/m4a/aac/flac/ogg/opus）
  let wavBuf;
  try {
    wavBuf = await decodeAudioTo16kWav(buffer, fileName);
  } catch (e) {
    throw new Error(e.message);
  }

  const HOST = 'office-api-ist-dx.iflyaisol.com';
  const signatureRandom = xfRandom16();

  // 1. 上传音频（body 为二进制；参与签名的参数拼在 URL）
  const uploadParams = {
    appId: XF_APP_ID,
    accessKeyId: XF_API_KEY,
    dateTime: xfDateTime(),
    signatureRandom,
    fileSize: String(wavBuf.length),
    fileName: 'hr_interview.wav',
    durationCheckDisable: 'true', // 关闭时长校验，免传 duration
    language: 'autodialect',
    roleType: '1', // 通用角色分离（面试双人场景）
  };
  const uploadUrl = `https://${HOST}/v2/upload?${buildQuery(uploadParams)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      signature: xfIfasrSignature(uploadParams, XF_APISECRET),
    },
    body: wavBuf,
  });
  if (!uploadRes.ok) {
    throw new Error(`讯飞音频上传失败：HTTP ${uploadRes.status} ${(await uploadRes.text()).slice(0, 200)}`);
  }
  const uploadData = await uploadRes.json();
  if (uploadData.code !== '000000') {
    throw new Error(`讯飞音频上传失败：${uploadData.code} ${uploadData.descInfo || ''}`);
  }
  const orderId = uploadData.content?.orderId;
  if (!orderId) {
    throw new Error('讯飞音频上传失败：未返回订单号');
  }

  // 2. 轮询查询结果（signatureRandom 需与上传一致；5s 间隔，最多 36 次 ≈ 3 分钟）
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    const queryParams = {
      accessKeyId: XF_API_KEY,
      dateTime: xfDateTime(), // 每次查询重新生成
      signatureRandom,
      orderId,
      resultType: 'transfer',
    };
    const queryRes = await fetch(`https://${HOST}/v2/getResult?${buildQuery(queryParams)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        signature: xfIfasrSignature(queryParams, XF_APISECRET),
      },
      body: '{}',
    });
    if (!queryRes.ok) {
      throw new Error(`讯飞任务查询失败：HTTP ${queryRes.status} ${(await queryRes.text()).slice(0, 200)}`);
    }
    const queryData = await queryRes.json();
    if (queryData.code !== '000000') {
      throw new Error(`讯飞任务查询失败：${queryData.code} ${queryData.descInfo || ''}`);
    }
    const info = queryData.content?.orderInfo || {};
    if (info.status === 4) {
      const text = parseXfIfasrResult(queryData.content?.orderResult || '');
      if (!text) {
        throw new Error('讯飞转写完成但未返回有效文本，请检查音频是否为静音或格式不符');
      }
      return { text, orderId };
    }
    if (info.status === -1) {
      throw new Error(`讯飞转写失败（failType=${info.failType}），请检查音频是否损坏、格式或时长是否符合要求`);
    }
  }
  throw new Error('讯飞转写超时（约 3 分钟内未完成），请稍后重试或改用转录文本');
}

const SCORE_DIMS = ['professional', 'communication', 'logic', 'match', 'quality'];
const SCORE_DIM_LABELS = { professional: '专业能力', communication: '沟通表达', logic: '逻辑思维', match: '岗位匹配', quality: '综合素质' };

/** AI 面试评分：简历 + 问题 + 转写文本 → 结构化评分 JSON */
async function aiInterviewScore({ resumeText, job, questions, transcript }) {
  const instructions = `你是资深 HR 面试评估专家。基于候选人简历、本次面试的问题清单和面试录音转写文本，对候选人本次面试表现进行客观评估。
要求：
1. 只依据转写文本中候选人的实际回答评估，不要脑补转写中不存在的信息；转写中的停顿、重复、口水词等如实反映回答质量。
2. 评估五个维度并各打 0-100 分：professional（专业能力：专业深度与岗位技能）、communication（沟通表达：表达清晰度、流畅度、条理性）、logic（逻辑思维：回答是否结构化、因果清晰）、match（岗位匹配度：与目标岗位的契合程度）、quality（综合素质：学习能力、责任心、稳定性、应变）。
3. 总分 totalScore（0-100 整数）。
4. strengths 分条列出候选人面试中的优势表现；weaknesses 分条列出劣势与不足；performance 描述整体面试表现（回答质量、表达、应变、态度等）；suggestion 给出后续面试建议与重点核实方向。
只输出一个严格的 JSON 对象（不要 Markdown 代码块、不要任何额外文字）：
{"totalScore":0,"dimensions":{"professional":0,"communication":0,"logic":0,"match":0,"quality":0},"strengths":"优势（每条用换行分隔）","weaknesses":"劣势（每条用换行分隔）","performance":"整体面试表现描述","suggestion":"后续建议"}`;

  const res = await fetch(`${BASE_URL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      reasoning: { effort: 'none' },
      instructions,
      input: [
        {
          role: 'user',
          content: `【目标岗位】${job}\n\n【候选人简历】\n${resumeText.slice(0, 8000)}\n\n【本次面试问题清单】\n${questions}\n\n【面试录音转写文本】\n${transcript}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek 面试评分失败: HTTP ${res.status}`);
  }
  const data = await res.json();
  const raw =
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text ||
    data.output?.[0]?.content ||
    '';
  const parsed = (parseJsonArray(raw) || [])[0] || {};
  const clamp = (v) => (typeof v === 'number' ? Math.max(0, Math.min(100, Math.round(v))) : null);
  const dimensions = {};
  for (const d of SCORE_DIMS) {
    dimensions[d] = clamp(parsed.dimensions?.[d]);
  }
  return {
    totalScore: clamp(parsed.totalScore),
    dimensions,
    strengths: String(parsed.strengths || ''),
    weaknesses: String(parsed.weaknesses || ''),
    performance: String(parsed.performance || ''),
    suggestion: String(parsed.suggestion || ''),
  };
}

// 面试评分上传：问题 PDF（必传 1 个）+ 面试录音（可选，≤50MB）+ 转写文本文件（可选，≤2MB）
// 50MB 上限兼顾免费实例内存（如 Koyeb Nano 256MB）：正常面试录音（mp3 30-60 分钟）约 5-20MB
const scoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 3, fileSize: 50 * 1024 * 1024 },
});

/** 读取同事上传的转写文本文件（.txt/.md/.docx，docx 用 mammoth 解析） */
async function readTranscriptFile(file) {
  const name = fixFileName(file.originalname);
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (file.buffer.length > 2 * 1024 * 1024) {
    throw new Error('转写文本文件过大（≤2MB）');
  }
  if (ext === 'txt' || ext === 'md' || ext === 'text' || ext === 'log') {
    return file.buffer.toString('utf8');
  }
  if (ext === 'docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }
  throw new Error('转写文本文件仅支持 .txt/.md/.docx 格式');
}

app.post(
  '/api/interview-score',
  scoreUpload.fields([
    { name: 'questionsPdf', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
    { name: 'transcriptFile', maxCount: 1 },
  ]),
  async (req, res) => {
    const { resumeFileName, transcript } = req.body || {};
    const questionsPdf = req.files?.questionsPdf?.[0];
    const audio = req.files?.audio?.[0];
    const transcriptFile = req.files?.transcriptFile?.[0];

    if (!resumeFileName) {
      return res.status(400).json({ error: '请选择一份简历' });
    }
    const cached = resumeCache.get(resumeFileName);
    if (!cached) {
      return res.status(404).json({ error: '未找到该简历的筛选记录，请先在「简历筛选」中上传简历打分' });
    }
    if (!questionsPdf) {
      return res.status(400).json({ error: '请上传功能3导出的面试问题 PDF' });
    }
    const manualTranscript = (transcript || '').trim();
    if (!audio && !manualTranscript && !transcriptFile) {
      return res.status(400).json({ error: '请上传面试录音、转写文本文件，或直接粘贴转录文本' });
    }

    try {
      // 1. 解析问题 PDF 文本
      let questionsText = '';
      try {
        questionsText = (await pdfParse(questionsPdf.buffer)).text || '';
      } catch {
        return res.status(400).json({ error: '问题 PDF 解析失败，请确认上传的是功能3导出的「预提问」PDF' });
      }
      if (!questionsText.trim()) {
        return res.status(400).json({ error: '问题 PDF 无法解析出文本' });
      }

      // 2. 转写文本：优先粘贴文本 → 上传文本文件 → 否则调讯飞转写录音
      let finalTranscript = manualTranscript;
      let asrOrderId = null;
      if (!finalTranscript && transcriptFile) {
        try {
          finalTranscript = await readTranscriptFile(transcriptFile);
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }
      if (!finalTranscript && audio) {
        try {
          const asr = await transcribeAudio({ buffer: audio.buffer, fileName: fixFileName(audio.originalname) });
          finalTranscript = asr.text;
          asrOrderId = asr.orderId;
        } catch (e) {
          return res.status(502).json({ error: `录音转写失败：${e.message}` });
        }
      }
      if (!finalTranscript) {
        return res.status(502).json({ error: '未获得面试转写文本，请提供转录文本或重试录音转写' });
      }

      // 3. DeepSeek 评分
      const ai = await aiInterviewScore({
        resumeText: cached.text,
        job: cached.job,
        questions: questionsText.slice(0, 6000),
        transcript: finalTranscript.slice(0, 20000),
      });

      res.json({
        resumeFileName,
        name: cached.name,
        job: cached.job,
        city: cached.city,
        score: cached.score,
        questionsText: questionsText.slice(0, 6000),
        transcript: finalTranscript.slice(0, 20000),
        asrOrderId,
        ai,
      });
    } catch (e) {
      console.error('[interview-score] 评分失败:', e.message);
      res.status(500).json({ error: `评分失败：${e.message}` });
    }
  }
);

/** 用 pdfkit 生成面试评分报告 PDF（AI 评分与人工调整后最终评分对照） */
function buildScorePdf({ fileName, name, job, city, ai, final, generatedAt }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fontPath = FONT_PATH;
      doc.registerFont('hei', fontPath);
      doc.font('hei');

      doc.fontSize(20).text('面试评分报告', { align: 'center' });
      doc.moveDown(1.2);
      doc.fontSize(12).text(`候选人：${name}`);
      doc.text(`岗位：${job || '未知'}${city ? `（${city}）` : ''}`);
      doc.text(`简历文件：${fileName}`);
      doc.text(`生成日期：${generatedAt}`);
      doc.moveDown(1);

      doc.fontSize(14).text('一、评分汇总', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(12).text(`综合评分：AI ${ai.totalScore ?? '—'} 分　／　最终 ${final.totalScore ?? '—'} 分`);
      for (const d of SCORE_DIMS) {
        const label = SCORE_DIM_LABELS[d] || d;
        doc.text(`${label}：AI ${ai.dimensions?.[d] ?? '—'} 分　／　最终 ${final.dimensions?.[d] ?? '—'} 分`);
      }
      doc.moveDown(1);

      doc.fontSize(14).text('二、面试优势', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(12).text(final.strengths || '未填写', { lineGap: 4 });
      doc.moveDown(0.8);

      doc.fontSize(14).text('三、面试劣势与不足', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(12).text(final.weaknesses || '未填写', { lineGap: 4 });
      doc.moveDown(0.8);

      doc.fontSize(14).text('四、整体面试表现', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(12).text(final.performance || '未填写', { lineGap: 4 });
      doc.moveDown(0.8);

      doc.fontSize(14).text('五、后续建议', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(12).text(final.suggestion || '未填写', { lineGap: 4 });
      doc.moveDown(0.8);

      doc.fontSize(14).text('六、人工评价', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(12).text(final.comment || '未填写', { lineGap: 4 });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

app.post('/api/score-pdf', async (req, res) => {
  const { resumeFileName, ai, final } = req.body || {};
  if (!resumeFileName || !ai || !final) {
    return res.status(400).json({ error: '缺少评分数据' });
  }
  const cached = resumeCache.get(resumeFileName);
  try {
    const pdf = await buildScorePdf({
      fileName: resumeFileName,
      name: cached?.name || resumeFileName.replace(/\.pdf$/i, ''),
      job: cached?.job,
      city: cached?.city,
      ai,
      final,
      generatedAt: new Date().toLocaleDateString('zh-CN'),
    });
    const baseName = resumeFileName.replace(/\.pdf$/i, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${baseName}-面试评分.pdf`)}`);
    res.send(pdf);
  } catch (e) {
    console.error('[score-pdf] 生成失败:', e.message);
    res.status(500).json({ error: `PDF 生成失败：${e.message}` });
  }
});

app.get('/', (_req, res) => {
  res.json({
    name: 'HR-Agent 后端代理服务',
    endpoints: {
      health: 'GET /health',
      census: 'POST /api/census',
      resumeScreening: 'POST /api/resume-screening',
      interviewPrep: 'POST /api/interview-prep',
      interviewPdf: 'POST /api/interview-pdf',
      interviewScore: 'POST /api/interview-score',
      scorePdf: 'POST /api/score-pdf',
    },
  });
});

app.listen(PORT, () => {
  console.log(`HR-Agent server 已启动: http://localhost:${PORT}`);
});
