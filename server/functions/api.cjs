// Netlify Functions 入口（CommonJS）：把 Express app 整体包装成 serverless handler
// 后端 index.js 为 CommonJS（server/package.json 无 type:module），避免函数包被误判为 ESM
const serverless = require('serverless-http');
const { app } = require('../index.js');

exports.handler = serverless(app);
