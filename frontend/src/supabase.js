// Supabase 客户端（前端仅用 anon key + 公开桶直传录音；service_role key 严禁出现在前端）
// 配置运行时从后端 /api/supabase-config 获取（避免构建产物硬编码敏感串触发 Netlify 密钥扫描）
import { createClient } from '@supabase/supabase-js';
import { API_BASE } from './api.js';

export const AUDIO_BUCKET = 'hr-audio';

let supabasePromise = null;

async function initSupabase() {
  try {
    const resp = await fetch(`${API_BASE}/api/supabase-config`, { method: 'GET' });
    if (!resp.ok) return null;
    const cfg = await resp.json();
    if (!cfg.url || !cfg.anonKey) return null;
    return createClient(cfg.url, cfg.anonKey);
  } catch {
    return null;
  }
}

/** 惰性初始化 Supabase 客户端（仅首次调用拉取配置） */
export async function getSupabase() {
  if (supabasePromise === null) supabasePromise = initSupabase();
  return supabasePromise;
}

/**
 * 上传面试录音到 Supabase Storage 公共桶，返回可直接供讯飞 urlLink 拉取的公共 URL
 * 未配置 Supabase 时抛错（上层回退到本地直传后端转写，用于自托管场景）
 */
export async function uploadInterviewAudio(file) {
  const sb = await getSupabase();
  if (!sb) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  const safe = (file.name || 'audio').replace(/[^\w\u4e00-\u9fa5.-]/g, '_');
  const path = `${Date.now()}-${safe}`;
  const { data, error } = await sb.storage.from(AUDIO_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'audio/wav',
  });
  if (error) {
    throw new Error(`录音上传失败：${error.message}`);
  }
  const { data: pub } = sb.storage.from(AUDIO_BUCKET).getPublicUrl(data.path);
  return pub.publicUrl;
}
