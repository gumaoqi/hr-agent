// Supabase 客户端（前端仅用 anon key + 公开桶直传录音；service_role key 严禁出现在前端）
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
export const AUDIO_BUCKET = 'hr-audio';

/**
 * 上传面试录音到 Supabase Storage 公共桶，返回可直接供讯飞 urlLink 拉取的公共 URL
 * 未配置 Supabase 时抛错（上层回退到本地直传后端转写，用于自托管场景）
 */
export async function uploadInterviewAudio(file) {
  if (!supabase) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  const safe = (file.name || 'audio').replace(/[^\w\u4e00-\u9fa5.-]/g, '_');
  const path = `${Date.now()}-${safe}`;
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'audio/wav',
  });
  if (error) {
    throw new Error(`录音上传失败：${error.message}`);
  }
  const { data: pub } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(data.path);
  return pub.publicUrl;
}
