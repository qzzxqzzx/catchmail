// server.js — catchmail 入口：同时拉起 SMTP 接收器与 Web 收件箱
// 用法：node src/server.js [--config=path/to/config.json] [--no-open]
// 软件版（catchmail.exe）：双击即用；首次运行自动生成 config.json；默认自动打开浏览器
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { join } from 'node:path';
import { loadConfig, log, APP_DIR, IS_SEA } from './util.js';
import { startSmtp } from './smtp.js';
import { startHttp } from './http.js';
import { Store } from './store.js';
import { parseMessage, addrOf } from './parse.js';

const cfg = loadConfig();
mkdirSync(cfg.dataDir, { recursive: true });
log.file = join(cfg.dataDir, 'catchmail.log');   // 日志同步落盘（封顶 5MB）

// 首次运行：把生效配置落成 config.json，方便用户直接改域名
if (!cfg.configExisted) {
  const template = { ...cfg };
  delete template.configPath;
  delete template.configExisted;
  writeFileSync(cfg.configPath, JSON.stringify(template, null, 2) + '\n');
  log(`[init] 已生成默认配置 ${cfg.configPath} —— 把 domains 改成你的域名并重启即可正式收信`);
}

const store = new Store(cfg.dataDir);
store.load();
log(`[store] 已恢复 ${store.count()} 封邮件`);

async function onMessage({ mailFrom, rcptTos, raw, peer }) {
  try {
    const msg = parseMessage(raw);
    const primary = addrOf(rcptTos[0] || '');
    const box = (primary.split('@')[0] || 'catchall').toLowerCase();
    const rec = store.add({ ...msg, box, rcptTo: rcptTos.join(', '), size: raw.length }, cfg.maxPerBox);
    writeFileSync(join(store.rawDir, rec.id + '.eml'), raw);
    log(`[smtp] ${peer} 收信 → ${box}: "${rec.subject}" 自 ${rec.from}（${raw.length}B${rec.code ? '，验证码 ' + rec.code : ''}）`);
    return rec;
  } catch (e) {
    log('[smtp] 入库失败:', e.message);
    return null;
  }
}

const openBrowser = (url) => {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, { shell: true }, () => {});
};
const wantOpen = !process.argv.includes('--no-open');

async function main() {
  let httpBound = false;
  try {
    await startSmtp({ port: cfg.smtpPort, host: cfg.smtpHost, domains: cfg.domains, maxBytes: cfg.maxMessageBytes }, onMessage);
    await startHttp({ port: cfg.httpPort, host: cfg.httpHost, store, publicDir: join(APP_DIR, 'public') });
    httpBound = true;
  } catch (e) {
    if (e.code === 'EADDRINUSE' && String(e.message).includes(String(cfg.httpPort))) {
      // HTTP 端口被占：大概率已经有一个 catchmail 在跑
      log(`[hint] 端口 ${cfg.httpPort} 已被占用——可能已有一个 catchmail 正在运行，直接打开它`);
      if (wantOpen) openBrowser(`http://${cfg.httpHost === '0.0.0.0' ? '127.0.0.1' : cfg.httpHost}:${cfg.httpPort}`);
      process.exit(0);
    }
    log(`[fatal] 启动失败: ${e.message}${e.code === 'EADDRINUSE' ? '（改 config.json 的 smtpPort/httpPort）' : ''}`);
    process.exit(1);
  }

  const shownHttp = `http://${cfg.httpHost === '0.0.0.0' ? '127.0.0.1' : cfg.httpHost}:${cfg.httpPort}`;
  console.log(`\n  catchmail ${IS_SEA ? '(软件版)' : '(开发版)'} 已就绪
  收件域名 : ${cfg.domains.join(', ')}
  SMTP     : ${cfg.smtpHost}:${cfg.smtpPort}  （MX 记录指到本机即可收信）
  收件箱   : ${shownHttp}
  数据目录 : ${cfg.dataDir}
  关闭本窗口/进程 = 停止收信；日志在 data/catchmail.log\n`);
  if (wantOpen) openBrowser(shownHttp);
  return httpBound;
}

main();
