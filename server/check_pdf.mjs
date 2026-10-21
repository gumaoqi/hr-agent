import fs from 'node:fs';
const buf = fs.readFileSync('E:/AndroidProject/AiMate/HR-Agent/server/score_pdf_test.pdf');
const text = buf.slice(0, 2000).toString('latin1');
console.log('PDF 头:', text.slice(0, 8));
const hasFont = buf.includes('simhei') || /FontFile2|FontFile3/.test(buf.toString('latin1'));
console.log('嵌入字体:', hasFont ? '是' : '否');
// 检查是否含中文字体对象
const all = buf.toString('latin1');
console.log('含 CID 中文编码（CIDFontType0）:', all.includes('CIDFontType0'));
