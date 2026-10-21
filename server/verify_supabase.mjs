// Supabase 就绪性验证：检查表可访问性 + 存储桶（部署联调前用）
// 运行：node verify_supabase.mjs（需 server/.env 已配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: buckets, error: be } = await sb.storage.listBuckets();
console.log('[Storage] buckets:', buckets?.map((b) => `${b.name}(${b.public ? 'public' : 'private'})`).join(', ') || '(无)', be?.message || '');

const hasAudio = buckets?.some((b) => b.name === 'hr-audio');
if (hasAudio) {
  const { data: items, error: ie } = await sb.storage.from('hr-audio').list('', { limit: 5 });
  console.log('[Storage] hr-audio 内容:', items?.map((i) => i.name).join(', ') || '(空)', ie?.message || '');
}

for (const t of ['hr_screened_resumes', 'hr_asr_jobs']) {
  const { data, error } = await sb.from(t).select('*').limit(1);
  console.log(`[Table] ${t}: ${error ? 'ERR ' + error.message : `OK（可访问，${data.length ? '已有数据' : '空表'}）`}`);
}
