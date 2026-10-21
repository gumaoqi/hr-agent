// 端到端测试：简历筛选 → 面试评分（转录文本路径）→ 结果 PDF
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const resumeDir = path.join(root, 'test-resumes');

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
console.log(`[1] 简历筛选: HTTP ${s1.status}, 张伟评分=${d1.items[0]?.score}`);

// 2. 面试评分（转录文本路径）
const transcript = `面试官：先做个自我介绍吧。
张伟：您好，我叫张伟，有8年Java开发经验，目前在成都一家互联网公司任高级Java开发，带3人小组。主要做过订单中台、营销平台这类高并发系统。
面试官：你简历里提到订单中台重构把QPS提升了3倍，具体是怎么做到的？
张伟：重构前订单核心链路QPS大概2000，重构后到了6000。主要做了三件事：一是把热点数据用Redis缓存，命中率到90%以上；二是把下单和支付这类异步化，引入消息队列削峰；三是对数据库做了分库分表，按用户ID哈希分16个库。压测是用JMeter做的，跑了3轮取稳定值。
面试官：分布式事务你用的Seata，说说选型和踩过的坑？
张伟：用的AT模式，因为改动小，对业务侵入低。踩过的坑主要是回滚时脏数据问题，尤其是并发更新同一行数据时，后面改成在关键操作加分布式锁，回滚率下降了很多。
面试官：秒杀场景怎么保证不超卖？
张伟：Redis预减库存，加Lua脚本保证原子性；扣减成功后发消息异步更新数据库库存，两边用对账任务保证最终一致。消息这块用了事务消息，消费端做幂等。
面试官：你期望薪资多少？未来规划？
张伟：目前18K左右，期望22K。未来3-5年想往架构方向走，希望能在成都稳定发展。
面试官：好的，还有什么想问的吗？
张伟：想问下团队技术栈和项目现状，以及加班情况。`;

const fd = new FormData();
fd.append('resumeFileName', '张伟-测试简历.pdf');
fd.append('questionsPdf', new Blob([fs.readFileSync(path.join(resumeDir, '张伟-预提问.pdf'))], { type: 'application/pdf' }), '张伟-预提问.pdf');
fd.append('transcript', transcript);
const s2 = await fetch('http://localhost:5173/api/interview-score', { method: 'POST', body: fd });
const d2 = await s2.json();
console.log(`[2] 面试评分: HTTP ${s2.status}`);
if (!s2.ok) {
  console.log('   错误:', d2.error);
  process.exit(1);
}
const ai = d2.ai;
console.log(`   综合评分=${ai.totalScore}, 维度: 专业=${ai.dimensions.professional} 沟通=${ai.dimensions.communication} 逻辑=${ai.dimensions.logic} 匹配=${ai.dimensions.match} 素质=${ai.dimensions.quality}`);
console.log('   优势:', ai.strengths.slice(0, 120).replace(/\n/g, ' / '));
console.log('   劣势:', ai.weaknesses.slice(0, 120).replace(/\n/g, ' / '));
console.log('   表现:', ai.performance.slice(0, 120));
console.log('   建议:', ai.suggestion.slice(0, 120));

// 3. 导出结果 PDF（模拟人工调整）
const final = {
  totalScore: ai.totalScore + 3,
  dimensions: { ...ai.dimensions, communication: ai.dimensions.communication + 5 },
  strengths: ai.strengths,
  weaknesses: ai.weaknesses,
  performance: ai.performance,
  suggestion: ai.suggestion,
  comment: '面试表现扎实，技术深度好，符合岗位要求，建议优先考虑。',
};
const s3 = await fetch('http://localhost:5173/api/score-pdf', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resumeFileName: '张伟-测试简历.pdf', ai, final }),
});
const buf = Buffer.from(await s3.arrayBuffer());
const outPdf = path.join(resumeDir, '张伟-面试评分.pdf');
fs.writeFileSync(outPdf, buf);
console.log(`[3] 结果 PDF: HTTP ${s3.status}, 大小=${buf.length} bytes, 文件名=${path.basename(outPdf)}`);
const parsed = await pdfParse(buf);
console.log('   PDF 文本（前 500 字）:');
console.log('   ' + parsed.text.slice(0, 500).replace(/\n/g, '\n   '));
