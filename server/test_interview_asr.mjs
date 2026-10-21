// 端到端测试：真实录音走讯飞 ASR → 面试评分
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

// 2. 面试评分（真实录音 → 纯 JS/WASM 解码 → 讯飞转写）
const audioName = process.argv[2] || '测试录音.wav';
const fd = new FormData();
fd.append('resumeFileName', '张伟-测试简历.pdf');
fd.append('questionsPdf', new Blob([fs.readFileSync(path.join(resumeDir, '张伟-预提问.pdf'))], { type: 'application/pdf' }), '张伟-预提问.pdf');
fd.append('audio', new Blob([fs.readFileSync(path.join(resumeDir, audioName))], { type: 'audio/wav' }), audioName);
console.log(`[2] 提交面试评分（录音 ${audioName} → 纯JS解码→讯飞大模型转写，异步中…）`);
const s2 = await fetch('http://localhost:5173/api/interview-score', { method: 'POST', body: fd });
const d2 = await s2.json();
console.log(`    HTTP ${s2.status}`);
if (!s2.ok) {
  console.log('   错误:', d2.error);
  process.exit(1);
}
console.log('   转写结果（讯飞）:');
console.log('   ' + d2.transcript.slice(0, 800).replace(/\n/g, '\n   '));
console.log('   ---');
const ai = d2.ai;
console.log(`   综合评分=${ai.totalScore}, 维度: 专业=${ai.dimensions.professional} 沟通=${ai.dimensions.communication} 逻辑=${ai.dimensions.logic} 匹配=${ai.dimensions.match} 素质=${ai.dimensions.quality}`);
console.log('   优势:', ai.strengths.slice(0, 100).replace(/\n/g, ' / '));
console.log('   劣势:', ai.weaknesses.slice(0, 100).replace(/\n/g, ' / '));
