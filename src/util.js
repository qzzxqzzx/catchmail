// util.js — 配置加载与公共小件（零依赖）
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

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
  dataDir: join(ROOT, 'data'),
};

export function loadConfig() {
  const cliArg = process.argv.find((a) => a.startsWith('--config='));
  const cfgPath = cliArg?.slice(9) || process.env.CM_CONFIG || join(ROOT, 'config.json');
  let fileCfg = {};
  if (cfgPath && existsSync(cfgPath)) {
    fileCfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  }
  const cfg = { ...DEFAULTS, ...fileCfg, configPath: cfgPath };
  cfg.domains = (cfg.domains || []).map((d) => String(d).toLowerCase().replace(/^\*\./, ''));
  if (!cfg.domains.length) cfg.domains = DEFAULTS.domains;
  return cfg;
}

// 域名匹配：精确或子域（配置 example.com 则接受 anything@example.com 和 a.b.example.com）
export function domainMatches(host, domains) {
  const h = String(host || '').toLowerCase();
  return domains.some((d) => h === d || h.endsWith('.' + d));
}
