// F1 岗位普查回归：并行搜索耗时验证（Netlify 函数 26s 限制） + score-pdf 导出回归
const BASE = 'http://localhost:3000';

const t0 = Date.now();
const res = await fetch(`${BASE}/api/census`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ job: 'Java开发工程师', city: '成都' }),
});
const data = await res.json();
const sec = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`F1 HTTP ${res.status} 耗时 ${sec}s`);
if (!res.ok) { console.log('错误:', JSON.stringify(data)); process.exit(1); }
if (Number(sec) > 26) { console.log('⚠️ 超过 Netlify 函数 26s 限制'); }
console.log(`职位数: ${Array.isArray(data.items) ? data.items.length : '?'}`);
const s = data.summary || {};
console.log('薪资:', JSON.stringify(s.salary), '学历:', JSON.stringify(s.education), '工作制度:', JSON.stringify(s.workSchedule));

// score-pdf 回归（用简化 ai/final 数据）
const res2 = await fetch(`${BASE}/api/score-pdf`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    resumeFileName: '张伟-测试简历.pdf',
    ai: { totalScore: 52, dimensions: { professional: 55, communication: 50, logic: 50, match: 60, quality: 48 } },
    final: { totalScore: 52, dimensions: { professional: 55, communication: 50, logic: 50, match: 60, quality: 48 }, strengths: 's', weaknesses: 'w', performance: 'p', suggestion: 'g', comment: '' },
  }),
});
const buf = await res2.arrayBuffer();
console.log(`F4 score-pdf HTTP ${res2.status} 大小 ${buf.byteLength}B`);
if (res2.ok && buf.byteLength < 50000) console.log('⚠️ PDF 偏小，可能字体/内容缺失');

console.log('回归完成');
