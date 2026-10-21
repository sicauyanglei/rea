#!/usr/bin/env node
// 应用宝 CDN 反爬挑战求解器：执行挑战 JS（最小 DOM shim）提取 cookie，然后用 cookie 直接下载 APK。
// 用法: node fetch-didi.js <apk_url> <输出文件>
const { execFileSync } = require('child_process');
const fs = require('fs');

const apkUrl = process.argv[2];
const outFile = process.argv[3];
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function curl(args) {
  return execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// 第 1 步：请求 APK URL（统一 HTTPS，跟随重定向），拿挑战 JS
const httpsUrl = apkUrl.replace(/^http:/, 'https:');
let body = curl(['-sL', '--connect-timeout', '30', '-A', UA, httpsUrl]);

if (body.startsWith('<script>')) {
  console.error('[*] 收到挑战 JS，长度', body.length);
  body = body.replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
  // 第 2 步：最小 DOM shim 执行挑战脚本，提取 document.cookie 写入
  const cookies = [];
  const docShim = {
    set cookie(v) { cookies.push(v); },
    get cookie() { return cookies.join('; '); },
  };
  const locShim = { href: apkUrl };
  const win = {
    document: docShim,
    location: locShim,
    setTimeout: () => 0, // 不执行重载
  };
  let round = 0;
  let solved = false;
  while (round < 3 && !solved) {
    round++;
    // 挑战脚本在顶层作用域直接执行（非严格模式，var 声明）
    const fn = new Function('window', 'document', 'location', 'setTimeout', body);
    fn(win, docShim, locShim, () => 0);
    const pairs = [];
    for (const c of cookies) {
      // 保留原始值（含末尾 #），只去掉 cookie 分隔分号
      pairs.push(c.replace(/;$/, ''));
    }
    const cookieHeader = pairs.join('; ');
    console.error('[*] 第', round, '轮提取 cookie:', cookieHeader);
    if (!cookieHeader || !cookieHeader.includes('EO_Bot_Ssid')) {
      console.error('[!] cookie 提取异常，挑战脚本内容:');
      console.error(body.slice(0, 500));
      process.exit(2);
    }
    // JS 里 setTimeout(...,0x4b0) 表示真实浏览器在 1.2s 后重载，模拟该时延
    execFileSync('sleep', ['1.5']);
    // 第 3 步：带 cookie + Android UA 重请求（HTTPS + 跟随重定向）
    execFileSync('curl', [
      '-sL', '--connect-timeout', '30',
      '-A', UA,
      '-H', 'Cookie: ' + cookieHeader,
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      '-o', outFile,
      httpsUrl,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    const buf = fs.readFileSync(outFile);
    if (buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
      solved = true;
    } else {
      // 又是新挑战：用响应体继续下一轮
      body = buf.toString('utf8').replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
      cookies.length = 0;
      console.error('[*] 第', round, '轮仍被挑战，进入下一轮');
    }
  }
  if (solved) {
    console.error('[+] 挑战通过');
    return;
  }
  const buf = fs.readFileSync(outFile);
  console.error('[!] 3 轮均未通过，最后响应前 300 字节:');
  console.error(buf.toString('utf8').slice(0, 300));
  process.exit(4);
} else if (body.startsWith('PK')) {
  // 直接就是 APK（ZIP 魔数）
  fs.writeFileSync(outFile, Buffer.from(body, 'utf8'));
} else {
  // 未知响应：原样保存供检查
  fs.writeFileSync(outFile + '.resp', body);
  console.error('[!] 未知响应，已保存到', outFile + '.resp', '前 300 字节:');
  console.error(body.slice(0, 300));
  process.exit(3);
}

// 第 4 步：校验产物
const buf = fs.readFileSync(outFile);
console.error('[*] 下载字节数:', buf.length);
if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
  console.error('[+] 是 ZIP/APK 格式');
} else {
  console.error('[-] 不是 APK（前 8 字节 hex）:', buf.subarray(0, 8).toString('hex'));
  process.exit(4);
}
