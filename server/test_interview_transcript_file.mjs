// 端到端测试：功能4 上传转写文本文件（txt / docx）→ AI 评分
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const resumeDir = path.join(root, 'test-resumes');

// 1. 简历筛选（写入缓存）
const form = new FormData();
form.append('city', '成都');
form.append('job', 'Java开发工程师');
form.append('salary', '不限');
form.append('education', '不限');
form.append('other', '3年以上Java开发经验');
form.append('resumes', new Blob([fs.readFileSync(path.join(resumeDir, '张伟-测试简历.pdf'))], { type: 'application/pdf' }), '张伟-测试简历.pdf');
const s1 = await fetch('http://localhost:5173/api/resume-screening', { method: 'POST', body: form });
const d1 = await s1.json();
console.log(`[1] 简历筛选: HTTP ${s1.status}, 张伟评分=${d1.items[0]?.score}`);

async function scoreWithFile(fileName, label) {
  const fd = new FormData();
  fd.append('resumeFileName', '张伟-测试简历.pdf');
  fd.append('questionsPdf', new Blob([fs.readFileSync(path.join(resumeDir, '张伟-预提问.pdf'))], { type: 'application/pdf' }), '张伟-预提问.pdf');
  fd.append('transcriptFile', new Blob([fs.readFileSync(path.join(resumeDir, fileName))], { type: 'application/octet-stream' }), fileName);
  console.log(`[2] 提交面试评分（转写文本文件 ${fileName}，不调用讯飞）…`);
  const s2 = await fetch('http://localhost:5173/api/interview-score', { method: 'POST', body: fd });
  const d2 = await s2.json();
  console.log(`    HTTP ${s2.status}`);
  if (!s2.ok) {
    console.log('   错误:', d2.error);
    return false;
  }
  const head = d2.transcript.slice(0, 60).replace(/\n/g, ' / ');
  console.log(`   转录文本前 60 字: ${head}...`);
  console.log(`   ASR 订单: ${d2.asrOrderId ?? '无（未调用讯飞）'}`);
  console.log(`   综合评分=${d2.ai.totalScore}, 维度: 专业=${d2.ai.dimensions.professional} 沟通=${d2.ai.dimensions.communication} 逻辑=${d2.ai.dimensions.logic} 匹配=${d2.ai.dimensions.match} 素质=${d2.ai.dimensions.quality}`);
  return true;
}

const okTxt = await scoreWithFile('面试记录文本.txt', 'txt');
const okDocx = await scoreWithFile('面试记录文本.docx', 'docx');
console.log(`\n结果: txt=${okTxt ? '通过' : '失败'} docx=${okDocx ? '通过' : '失败'}`);
process.exit(okTxt && okDocx ? 0 : 1);
