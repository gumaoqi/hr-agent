/**
 * 后端 API 基地址：
 * - 生产构建：读取环境变量 VITE_API_BASE（在 Netlify 站点设置里配置为后端域名，如 https://hr-agent.onrender.com）
 * - 本地开发：未配置时为空字符串，走 Vite 代理 /api → localhost:3000
 */
export const API_BASE = import.meta.env.VITE_API_BASE || '';

/** 调用后端 /api/census 执行岗位普查 */
export async function census(job, city) {
  const res = await fetch(`${API_BASE}/api/census`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job, city }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
  }
  return data;
}
