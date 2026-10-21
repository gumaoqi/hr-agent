// Netlify Functions handler 冒烟测试：模拟函数运行时调用包装后的 Express
import { handler } from './functions/api.js';

async function call(path, method = 'GET', body = null) {
  const res = await handler(
    { httpMethod: method, path, headers: {}, queryStringParameters: {}, body, isBase64Encoded: false },
    {}
  );
  return res;
}

const health = await call('/health');
console.log('GET /health →', health.statusCode, health.body?.slice(0, 80));

const root = await call('/');
console.log('GET / →', root.statusCode, root.body?.slice(0, 80));

const missing = await call('/api/nonexistent');
console.log('GET /api/nonexistent →', missing.statusCode, missing.body?.slice(0, 80));
console.log('冒烟测试完成');
