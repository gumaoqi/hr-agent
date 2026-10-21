// 诊断：读取最近一次 hr_asr_jobs 任务，直接调用讯飞 getResult 打印原始返回
// 运行：HTTPS_PROXY=http://127.0.0.1:7897 NODE_USE_ENV_PROXY=1 node diagnose_asr.mjs
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import 'dotenv/config';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await sb.from('hr_asr_jobs').select('*').order('created_at', { ascending: false }).limit(1);
if (!data || !data.length) { console.log('无任务记录'); process.exit(1); }
const job = data[0];
console.log('任务:', job.order_id, 'signature_random:', job.signature_random);

function xfDateTime() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const offMin = -now.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}
function buildQuery(params) {
  return Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}
function sign(params, secret) {
  const keys = Object.keys(params).sort();
  const parts = [];
  for (const k of keys) {
    const v = params[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return crypto.createHmac('sha1', secret).update(parts.join('&')).digest('base64');
}

const HOST = 'office-api-ist-dx.iflyaisol.com';
const queryParams = {
  accessKeyId: process.env.XF_API_KEY,
  dateTime: xfDateTime(),
  signatureRandom: job.signature_random,
  orderId: job.order_id,
  resultType: 'transfer',
};
const res = await fetch(`https://${HOST}/v2/getResult?${buildQuery(queryParams)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', signature: sign(queryParams, process.env.XF_APISECRET) },
  body: '{}',
});
const text = await res.text();
console.log('HTTP', res.status);
console.log('RAW:', text.slice(0, 3000));
