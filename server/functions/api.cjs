// Netlify Functions 入口（CJS 版）：把 Express app 整体包装成 serverless handler
// 使用 .cjs 扩展名强制 CommonJS，Netlify 以 CJS 加载最稳定；
// 后端 index.js 为 ESM，通过动态 import() 加载（Node 22 原生支持）
const serverless = require('serverless-http');

let handlerPromise = null;

async function getHandler() {
  if (!handlerPromise) {
    const mod = await import('../index.js');
    handlerPromise = serverless(mod.app);
  }
  return handlerPromise;
}

exports.handler = async (event, context) => {
  const handler = await getHandler();
  return handler(event, context);
};
