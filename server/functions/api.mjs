// Netlify Functions 入口：把 Express app 整体包装成 serverless handler
// 前端 /api/* 请求经 netlify.toml 重写规则转发到本函数
import serverless from 'serverless-http';
import { app } from '../index.js';

export const handler = serverless(app);
