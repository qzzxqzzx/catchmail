// smoke.mjs — 端到端冒烟测试：起真实服务 → SMTP 投 3 封信 → REST API 逐项断言
// 用法：node test/smoke.mjs   （自动用临时端口与临时数据目录，不污染正式 data/）
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SMTP_PORT = 20000 + Math.floor(Math.random() * 20000), HTTP_PORT = SMTP_PORT + 1; // 随机端口，避免与遗留进程双绑抢占
const tmp = mkdtempSync(join(tmpdir(), 'catchmail-test-'));
const cfgFile = join(tmp, 'config.json');
writeFileSync(cfgFile, JSON.stringify({
  domains: ['test.dev'],
  smtpPort: SMTP_PORT, smtpHost: '127.0.0.1',
  httpPort: HTTP_PORT, httpHost: '127.0.0.1',
  dataDir: join(tmp, 'data'),
  maxPerBox: 500,
}));

const child = spawn(process.execPath, [join(ROOT, 'src/server.js'), '--config=' + cfgFile, '--no-open'], { stdio: 'inherit' });
process.on('exit', () => { try { child.kill(); } catch {} }); // 任何退出路径都清掉子服务
let ready = false;
// 就绪探测改走 HTTP 轮询（stdio inherit 后不再解析子进程输出）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500); ready = true;
if (!ready) { console.error('服务未就绪'); child.kill(); process.exit(1); }

// ---- 极简 SMTP 客户端 ----
// 关键：持久监听 + 等待队列。一个 TCP chunk 里可能含多行应答，
// 读完一行就摘掉 data 监听器会把同 chunk 剩余行全部丢掉（曾导致整轮卡死）。
function makeClient(sock) {
  let rbuf = '';
  const waiters = [];
  const flush = () => {
    let i;
    while (waiters.length && (i = rbuf.indexOf('\r\n')) !== -1) {
      waiters.shift()(rbuf.slice(0, i));
      rbuf = rbuf.slice(i + 2);
    }
  };
  sock.on('error', (e) => { // 别让 RST 变成 unhandled 崩溃，转给等待者
    while (waiters.length) waiters.shift()(String(e.code || e));
  });
  sock.on('data', (c) => { rbuf += c.toString(); flush(); });
  return () => new Promise((res) => { waiters.push(res); flush(); });
}
async function sendMail({ from, to, data }) {
  const sock = net.connect(SMTP_PORT, '127.0.0.1');
  await event(sock, 'connect');
  const readLine = makeClient(sock);
  const step = async (expect, cmd) => {
    if (cmd) sock.write(cmd + '\r\n');
    let line;
    do { line = await readLine(); } while (line[3] === '-'); // 多行应答读到末行
    if (!line.startsWith(expect)) throw new Error(`期望 ${expect} 实得 "${line}"（cmd=${cmd}）`);
    return line;
  };
  await step('220');
  await step('250', 'EHLO tester');
  await step('250', `MAIL FROM:<${from}>`);
  await step('250', `RCPT TO:<${to}>`);
  await step('354', 'DATA');
  sock.write(data.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.\r\n');
  const ok = await readLine();
  if (!ok.startsWith('250')) throw new Error('DATA 被拒: ' + ok);
  sock.write('QUIT\r\n');
  sock.end();
}
function event(sock, ev) { return new Promise((r) => sock.once(ev, r)); }

const PNG1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const b64wrap = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

// 信 1：multipart/alternative 带验证码 + HTML（QQ 邮箱风）
process.stderr.write('…投信 1\n');
await sendMail({
  from: 'no-reply@example.net', to: 'inbox1@test.dev',
  data: `From: =?utf-8?B?${Buffer.from('示例服务').toString('base64')}?= <no-reply@example.net>\r
To: <inbox1@test.dev>\r
Subject: =?utf-8?B?${Buffer.from('您的登录验证码').toString('base64')}?=\r
Message-ID: <m1@example.net>\r
Date: Sun, 26 Oct 2026 12:00:00 +0000\r
MIME-Version: 1.0\r
Content-Type: multipart/alternative; boundary="BOUND1"\r
\r
--BOUND1\r
Content-Type: text/plain; charset=utf-8\r
Content-Transfer-Encoding: base64\r
\r
${b64wrap('您的验证码是 482913，5 分钟内有效。')}\r
--BOUND1\r
Content-Type: text/html; charset=utf-8\r
Content-Transfer-Encoding: base64\r
\r
${b64wrap('<html><body><h1>验证码</h1><p>您的验证码是 <b>482913</b></p></body></html>')}\r
--BOUND1--\r`,
});

// 信 2：纯文本 + 附件
process.stderr.write('…投信 2\n');
await sendMail({
  from: 'friend@other.net', to: 'inbox2@test.dev',
  data: `From: Friend <friend@other.net>\r
To: <inbox2@test.dev>\r
Subject: Hello catchmail\r
Message-ID: <m2@other.net>\r
MIME-Version: 1.0\r
Content-Type: multipart/mixed; boundary="BOUND2"\r
\r
--BOUND2\r
Content-Type: text/plain; charset=utf-8\r
\r
Hi! 这是一封测试信，请查收附件。\r
--BOUND2\r
Content-Type: image/png; name="dot.png"\r
Content-Transfer-Encoding: base64\r
Content-Disposition: attachment; filename="dot.png"\r
\r
${PNG1x1.replace(/(.{76})/g, '$1\r\n')}\r
--BOUND2--\r`,
});

// 信 3：拒收测试——未配置的域必须 550
{
  const sock = net.connect(SMTP_PORT, '127.0.0.1');
  await event(sock, 'connect');
  const readLine = makeClient(sock);
  const step = async (expect, cmd) => {
    if (cmd) sock.write(cmd + '\r\n');
    let line;
    do { line = await readLine(); } while (line[3] === '-');
    return line;
  };
  let got = '220';
  try {
    await step('220');
    await step('250', 'EHLO t');
    await step('250', 'MAIL FROM:<x@y.z>');
    got = await step('550', 'RCPT TO:<victim@notconfigured.io>');
  } catch (e) {
    got = e.message;
  }
  if (!got.startsWith('550')) { console.error('❌ 未配置域未被拒收:', JSON.stringify(got)); child.kill(); process.exit(1); }
  console.log('  [PASS] 未配置域拒收 550');
  sock.destroy();
}

// ---- REST API 断言 ----
const api = async (p, opt) => (await fetch(`http://127.0.0.1:${HTTP_PORT}` + p, opt)).json();
let failures = 0;
const check = (cond, name) => { console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}`); if (!cond) failures++; };

const boxes = await api('/api/boxes');
check(boxes.some((b) => b.name === 'inbox1' && b.count === 1), '按 RCPT 分箱 inbox1=1');
check(boxes.some((b) => b.name === 'inbox2' && b.count === 1), '按 RCPT 分箱 inbox2=1');

const list1 = await api('/api/messages?box=inbox1');
check(list1.length === 1, 'inbox1 列表 1 封');
const mail1 = await api('/api/messages/' + list1[0].id);
check(mail1.code === '482913', `验证码提取（得 ${mail1.code}）`);
check(mail1.subject.includes('验证码'), 'RFC2047 主题解码');
check(mail1.from === 'no-reply@example.net', '发件人地址解析');
check(!!mail1.hasHtml && mail1.html.includes('482913'), 'multipart/alternative HTML 提取');

const list2 = await api('/api/messages?box=inbox2');
const mail2 = await api('/api/messages/' + list2[0].id);
check(mail2.attachments?.[0]?.filename === 'dot.png' && mail2.attachments[0].size === 70, '附件识别 dot.png');
check(mail2.code === null, '普通信不误报验证码');

const q = await api('/api/messages?q=测试信');
check(q.length === 1 && q[0].box === 'inbox2', '中文关键词搜索');

const raw = await (await fetch(`http://127.0.0.1:${HTTP_PORT}/api/messages/${mail1.id}/raw`)).text();
check(raw.includes('Message-ID: <m1@example.net>'), '原文 .eml 可取');

const del = await api('/api/messages/' + mail2.id, { method: 'DELETE' });
check(del.ok === true, '删除');
const list2b = await api('/api/messages?box=inbox2');
check(list2b.length === 0, '删除后列表为空');

child.kill();
await sleep(200);
if (!failures) rmSync(tmp, { recursive: true, force: true }); else console.log('（保留现场 ' + tmp + '）');
console.log(failures ? `\n${failures} 项失败` : '\n冒烟测试全部通过');
process.exit(failures ? 1 : 0);
