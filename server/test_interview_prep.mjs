// 端到端测试：简历筛选 → 面试准备 → PDF 导出
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const resumeDir = path.join(root, 'test-resumes');
const outDir = path.join(root, 'test-resumes');

// 1. 简历筛选（写入缓存）
const form = new FormData();
form.append('city', '成都');
form.append('job', 'Java开发工程师');
form.append('salary', '不限');
form.append('education', '不限');
form.append('other', '3年以上Java开发经验');
for (const f of ['张伟-测试简历.pdf']) {
  form.append('resumes', new Blob([fs.readFileSync(path.join(resumeDir, f))], { type: 'application/pdf' }), f);
}
const s1 = await fetch('http://localhost:5173/api/resume-screening', { method: 'POST', body: form });
const d1 = await s1.json();
console.log(`[1] 简历筛选: HTTP ${s1.status}, items=${d1.count}, 张伟评分=${d1.items[0]?.score}`);

// 2. 生成面试问题
const s2 = await fetch('http://localhost:5173/api/interview-prep', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fileName: '张伟-测试简历.pdf', specialNeed: '重点考察分布式系统设计与高并发方案' }),
});
const d2 = await s2.json();
console.log(`[2] 面试问题: HTTP ${s2.status}, 数量=${d2.questions?.length}`);
d2.questions?.forEach((q, i) => console.log(`   Q${i + 1}: ${q.q}\n        意图: ${q.intent}`));

// 3. 导出 PDF（取前 3 题）
const s3 = await fetch('http://localhost:5173/api/interview-pdf', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fileName: '张伟-测试简历.pdf', questions: (d2.questions || []).slice(0, 3) }),
});
const buf = Buffer.from(await s3.arrayBuffer());
const outPdf = path.join(outDir, '张伟-预提问.pdf');
fs.writeFileSync(outPdf, buf);
console.log(`[3] PDF 导出: HTTP ${s3.status}, 大小=${buf.length} bytes`);
const parsed = await pdfParse(buf);
console.log('   PDF 文本前 300 字:');
console.log('   ' + parsed.text.slice(0, 300).replace(/\n/g, '\n   '));
