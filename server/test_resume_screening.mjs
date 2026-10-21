// 端到端测试：简历筛选接口
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-resumes');
const files = ['张伟-测试简历.pdf', '李娜-测试简历.pdf', '王强-测试简历.pdf'];

const form = new FormData();
form.append('city', '成都');
form.append('job', 'Java开发工程师');
form.append('salary', '不限');
form.append('education', '不限');
form.append('other', '3年以上Java开发经验');
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  form.append('resumes', new Blob([buf], { type: 'application/pdf' }), f);
}

const started = Date.now();
const res = await fetch('http://localhost:5173/api/resume-screening', {
  method: 'POST',
  body: form,
});
const data = await res.json();
console.log(`HTTP ${res.status} 耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (!res.ok) {
  console.log('错误:', JSON.stringify(data));
  process.exit(1);
}
console.log(`共 ${data.count} 份，排序如下：`);
for (const it of data.items) {
  console.log('\n-----------------------------');
  console.log(`姓名: ${it.name} | 评分: ${it.score} | 文件: ${it.fileName}`);
  console.log(`真实性: ${it.authenticity}`);
  console.log(`缺点: ${it.weaknesses}`);
  console.log(`亮点: ${it.highlights}`);
}
