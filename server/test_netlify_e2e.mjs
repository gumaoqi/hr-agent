// Netlify+Supabase 改造端到端联调（走本地后端 localhost:3000；Supabase 直连需代理环境）
// 覆盖：F2 简历筛选（写 Supabase 表）→ F3 面试问题 → F4 录音 urlLink 异步转写+评分
// 运行：HTTPS_PROXY=http://127.0.0.1:7897 NODE_USE_ENV_PROXY=1 node test_netlify_e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const BASE = 'http://localhost:3000';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-resumes');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const log = (m) => console.log(`\n== ${m}`);

// ---- F2：简历筛选（写 Supabase 缓存表）----
log('F2 简历筛选');
{
  const form = new FormData();
  form.append('city', '成都');
  form.append('job', 'Java开发工程师');
  form.append('salary', '不限');
  form.append('education', '不限');
  form.append('other', '3年以上Java开发经验');
  for (const f of ['张伟-测试简历.pdf', '李娜-测试简历.pdf', '王强-测试简历.pdf']) {
    const buf = fs.readFileSync(path.join(root, f));
    form.append('resumes', new Blob([buf], { type: 'application/pdf' }), f);
  }
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/resume-screening`, { method: 'POST', body: form });
  const data = await res.json();
  console.log(`HTTP ${res.status} 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!res.ok) throw new Error(JSON.stringify(data));
  console.log(`筛选 ${data.count} 份:`, data.items.map((i) => `${i.name}:${i.score}`).join(' | '));
}
// 验证 Supabase 表有数据
{
  const { count } = await sb.from('hr_screened_resumes').select('*', { count: 'exact', head: true });
  console.log('[Supabase] hr_screened_resumes 行数 =', count);
  if (!count) throw new Error('F2 未写入 Supabase 缓存表');
}

// ---- F3：面试问题（从 Supabase 缓存读简历）----
log('F3 面试问题');
{
  const res = await fetch(`${BASE}/api/interview-prep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: '张伟-测试简历.pdf', specialNeed: '考察项目经验深度' }),
  });
  const data = await res.json();
  console.log(`HTTP ${res.status} 问题数:`, Array.isArray(data.questions) ? data.questions.length : JSON.stringify(data));
  if (!res.ok || !Array.isArray(data.questions)) throw new Error('F3 失败');
}

// ---- F4：录音 urlLink 异步转写 + 评分 ----
log('F4 录音异步转写（urlLink）');
{
  // 1. 上传测试录音到 hr-audio 桶（模拟前端直传）
  const audioPath = path.join(root, '测试录音.mp3');
  if (!fs.existsSync(audioPath)) throw new Error('缺少测试录音.mp3');
  const file = fs.readFileSync(audioPath);
  const up = await sb.storage.from('hr-audio').upload(`e2e-${Date.now()}.mp3`, file, { contentType: 'audio/mpeg', upsert: true });
  if (up.error) throw new Error('录音上传失败: ' + up.error.message);
  const { data: pub } = sb.storage.from('hr-audio').getPublicUrl(up.data.path);
  console.log('录音公共 URL:', pub.publicUrl);

  // 2. 提交评分（audioUrl 模式）
  const form = new FormData();
  form.append('resumeFileName', '张伟-测试简历.pdf');
  const qBuf = fs.readFileSync(path.join(root, '张伟-预提问.pdf'));
  form.append('questionsPdf', new Blob([qBuf], { type: 'application/pdf' }), '张伟-预提问.pdf');
  form.append('audioUrl', pub.publicUrl);
  form.append('audioSize', String(file.length));
  const t1 = Date.now();
  const res = await fetch(`${BASE}/api/interview-score`, { method: 'POST', body: form });
  const data = await res.json();
  console.log(`提交 HTTP ${res.status} 耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  if (!res.ok) throw new Error(JSON.stringify(data));
  if (!data.pending) throw new Error('预期 pending 提交，收到: ' + JSON.stringify(data));
  console.log('orderId:', data.orderId);

  // 3. 轮询查询
  let final = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const q = await fetch(`${BASE}/api/interview-score-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: data.orderId }),
    });
    const qd = await q.json();
    if (!q.ok) throw new Error(JSON.stringify(qd));
    if (!qd.pending) { final = qd; break; }
    console.log(`  轮询 ${i + 1}: 转写中…`);
  }
  if (!final) throw new Error('转写超时（3分钟）');
  console.log(`转写完成耗时 ${((Date.now() - t1) / 1000).toFixed(0)}s，转写文本长度 ${final.transcript.length}`);
  console.log('AI 评分:', JSON.stringify(final.ai, null, 2).slice(0, 600));
  // 验证 asr 任务表
  const { count } = await sb.from('hr_asr_jobs').select('*', { count: 'exact', head: true });
  console.log('[Supabase] hr_asr_jobs 行数 =', count);
}

log('端到端联调通过 ✅');
