// server.js — catchmail 入口：同时拉起 SMTP 接收器与 Web 收件箱
// 用法：node src/server.js [--config=path/to/config.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, log } from './util.js';
import { startSmtp } from './smtp.js';
import { startHttp } from './http.js';
import { Store } from './store.js';
import { parseMessage, addrOf } from './parse.js';

const cfg = loadConfig();
mkdirSync(cfg.dataDir, { recursive: true });
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

await startSmtp({ port: cfg.smtpPort, host: cfg.smtpHost, domains: cfg.domains, maxBytes: cfg.maxMessageBytes }, onMessage);
await startHttp({ port: cfg.httpPort, host: cfg.httpHost, store, publicDir: join(import.meta.dirname, '..', 'public') });

console.log(`\n  catchmail 已就绪
  收件域名 : ${cfg.domains.join(', ')}
  SMTP     : ${cfg.smtpHost}:${cfg.smtpPort}  （MX 记录指到本机即可收信）
  收件箱   : http://${cfg.httpHost}:${cfg.httpPort}
  数据目录 : ${cfg.dataDir}\n`);
