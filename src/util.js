// util.js — 配置加载与公共小件（零依赖）
// 路径规则：打包成 exe（SEA）后一切以 exe 所在目录为准；
// 开发态（node src/server.js / npm start）以仓库根为准。
// 刻意不用 import.meta：SEA 要先把入口打成单文件 CJS，import.meta 会炸。
import { readFileSync, existsSync, appendFileSync, statSync, truncateSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// SEA 里 process.argv[1] 等于 execPath 本身；开发态是 src/server.js
const arg1 = process.argv[1] ? resolve(process.argv[1]) : '';
export const IS_SEA = !arg1 || arg1 === resolve(process.execPath);
export const APP_DIR = IS_SEA
  ? dirname(process.execPath)
  : (existsSync(join(process.cwd(), 'package.json')) ? process.cwd() : dirname(dirname(arg1)));

export function log(...a) {
  const line = `${new Date().toISOString()} ${a.join(' ')}`;
  console.log(line);
  if (log.file) {
    try {
      if (statSync(log.file).size > 5 * 1024 * 1024) truncateSync(log.file, 0); // 简单封顶
    } catch { /* 文件还不存在 */ }
    try { appendFileSync(log.file, line + '\n'); } catch { /* 磁盘问题不致命 */ }
  }
}
log.file = '';

export function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

const DEFAULTS = {
  domains: ['example.com'],   // 接收这些域名的所有地址（catch-all）
  smtpPort: 25,               // 生产 25；开发可用 2525
  smtpHost: '0.0.0.0',
  httpPort: 8025,
  httpHost: '127.0.0.1',      // Web 界面默认只听本机，需要局域网访问再改
  maxMessageBytes: 10 * 1024 * 1024,
  maxPerBox: 500,             // 每个收件箱保留条数
  dataDir: join(APP_DIR, 'data'),
};

export function loadConfig() {
  const cliArg = process.argv.find((a) => a.startsWith('--config='));
  const cfgPath = cliArg?.slice(9) || process.env.CM_CONFIG || join(APP_DIR, 'config.json');
  let fileCfg = {};
  const exists = cfgPath && existsSync(cfgPath);
  if (exists) {
    try {
      fileCfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      console.error(`config.json 解析失败（${e.message}），使用默认配置`);
    }
  }
  const cfg = { ...DEFAULTS, ...fileCfg, configPath: cfgPath, configExisted: exists };
  cfg.domains = (cfg.domains || []).map((d) => String(d).toLowerCase().replace(/^\*\./, ''));
  if (!cfg.domains.length) cfg.domains = DEFAULTS.domains;
  return cfg;
}

// 域名匹配：精确或子域（配置 example.com 则接受 anything@example.com 和 a.b.example.com）
export function domainMatches(host, domains) {
  const h = String(host || '').toLowerCase();
  return domains.some((d) => h === d || h.endsWith('.' + d));
}
