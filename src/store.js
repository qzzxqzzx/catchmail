// store.js — 追加式 JSONL 存储（WAL 思路：追加落盘 + 启动重放恢复），零依赖
import { readFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from './util.js';

const CODE_BEFORE = /(?:验证码|校验码|驗證碼|verification code|security code|confirm(?:ation)? code|otp|passcode|pin code|code is|code:)\D{0,24}?(\d{4,8})/i;
const CODE_AFTER = /(\d{4,8})\D{0,24}?(?:是你的验证码|为验证码|是您的验证码|is your (?:verification |security )?code)/i;
const CODE_STANDALONE = /(?:^|\D)(\d{4,8})(?:\D|$)/;

// 从主题/正文提取验证码；找不到返回 null
export function extractCode(subject = '', text = '') {
  const hay = `${subject}\n${text}`.slice(0, 8000);
  const short = hay.length < 400; // 短邮件才允许裸数字兜底，避免误报
  const m = hay.match(CODE_BEFORE) || hay.match(CODE_AFTER)
    || (short && /码|code|otp/i.test(hay) ? hay.match(CODE_STANDALONE) : null);
  return m ? m[1] : null;
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = join(dataDir, 'messages.jsonl');
    this.rawDir = join(dataDir, 'raw');
    this.map = new Map(); // id -> record（不含 raw）
    this.order = [];      // id，新 → 旧
  }

  load() {
    mkdirSync(this.rawDir, { recursive: true });
    if (!existsSync(this.file)) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.deleted) { this.map.delete(rec.id); this.order = this.order.filter((x) => x !== rec.id); continue; }
        this.map.set(rec.id, rec);
        if (!this.order.includes(rec.id)) this.order.unshift(rec.id);
      } catch { /* 尾部半行（断电）可忽略 */ }
    }
  }

  /** mail: parseMessage 输出 + { box, rcptTo, raw } */
  add(mail, maxPerBox) {
    const rec = {
      id: newId(),
      ts: Date.now(),
      box: mail.box,
      to: mail.to || mail.rcptTo,
      from: mail.from,
      fromName: mail.fromName || '',
      subject: mail.subject,
      date: mail.date,
      text: (mail.text || '').slice(0, 100000),
      hasHtml: !!mail.html,
      html: (mail.html || '').slice(0, 500000),
      attachments: mail.attachments || [],
      code: extractCode(mail.subject, mail.text || stripHtml(mail.html)),
      size: mail.size || 0,
    };
    this.map.set(rec.id, rec);
    this.order.unshift(rec.id);
    appendLine(this.file, JSON.stringify(rec));
    this.trimBox(rec.box, maxPerBox);
    return rec;
  }

  trimBox(box, maxPerBox) {
    const inBox = this.order.filter((id) => this.map.get(id)?.box === box);
    for (const id of inBox.slice(maxPerBox)) this.delete(id);
  }

  get(id) { return this.map.get(id) || null; }

  list({ box, q, limit = 200 } = {}) {
    let ids = this.order;
    if (box) ids = ids.filter((id) => this.map.get(id)?.box === box);
    let items = ids.map((id) => this.map.get(id)).filter(Boolean);
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((r) =>
        r.subject.toLowerCase().includes(needle) ||
        r.from.toLowerCase().includes(needle) ||
        r.to.toLowerCase().includes(needle) ||
        r.text.toLowerCase().includes(needle));
    }
    return items.slice(0, limit).map(preview);
  }

  boxes() {
    const counts = new Map();
    for (const id of this.order) {
      const r = this.map.get(id);
      counts.set(r.box, (counts.get(r.box) || 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  delete(id) {
    if (!this.map.has(id)) return false;
    this.map.delete(id);
    this.order = this.order.filter((x) => x !== id);
    appendLine(this.file, JSON.stringify({ deleted: true, id }));
    try { unlinkSync(join(this.rawDir, id + '.eml')); } catch { /* 无原文 */ }
    return true;
  }

  clear(box) {
    for (const id of [...this.order]) {
      if (!box || this.map.get(id)?.box === box) this.delete(id);
    }
  }

  count() { return this.order.length; }
}

function preview(r) {
  return { ...r, html: undefined, text: (r.text || '').slice(0, 300) };
}

function appendLine(file, line) {
  appendFileSync(file, line + '\n');
}

export function stripHtml(html = '') {
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
}
