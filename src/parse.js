// parse.js — 极简 RFC 822/2045/2047 解析：头部展开、编码词、multipart 递归、base64/QP 正文
// 只覆盖收验证码/通知类邮件所需的常见形态，不追求完整 MIME 实现。

const HDR_BODY_SPLIT = /\r?\n\r?\n/;

function unfoldHeaders(headerText) {
  // 折叠行（空格/Tab 开头）并回上一行
  const lines = headerText.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += ' ' + line.trim();
    else out.push(line);
  }
  return out;
}

function parseHeaderLine(line) {
  const i = line.indexOf(':');
  if (i <= 0) return null;
  return [line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()];
}

// Content-Type: text/html; charset="utf-8" → { value, params }
export function parseHeaderParams(v = '') {
  const segs = v.split(';');
  const value = segs[0].trim().toLowerCase();
  const params = {};
  for (const seg of segs.slice(1)) {
    const m = seg.match(/^\s*([\w-]+)\s*=\s*(.*)\s*$/);
    if (m) params[m[1].toLowerCase()] = m[2].replace(/^"|"$/g, '');
  }
  return { value, params };
}

// RFC 2047 编码词：=?charset?B/Q?...?=
function decodeWord(charset, enc, data) {
  try {
    const buf = enc.toUpperCase() === 'B'
      ? Buffer.from(data, 'base64')
      : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary');
    return new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    return data;
  }
}
const decodeEncodedWords = (s = '') =>
  s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, data) => decodeWord(cs, enc, data))
    .replace(/\?=\s+=\?/g, '?==?'); // 相邻编码词去空格残留

export function decodeQuotedPrintable(s) {
  return s
    .replace(/=\r?\n/g, '') // 软换行
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function toText(buf, charset) {
  try {
    return new TextDecoder((charset || 'utf-8').toLowerCase()).decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

function splitHeaders(raw) {
  const m = raw.match(HDR_BODY_SPLIT);
  if (!m) return [raw, ''];
  return [raw.slice(0, m.index), raw.slice(m.index + m[0].length)];
}

function headersOf(headerText) {
  const map = {};
  for (const line of unfoldHeaders(headerText)) {
    const kv = parseHeaderLine(line);
    if (kv) map[kv[0]] = decodeEncodedWords(kv[1]);
  }
  return map;
}

// 递归解析一个 part（含 multipart）
function parsePart(rawText, depth = 0, out = { textParts: [], htmlParts: [], attachments: [] }) {
  const [headerText, bodyText] = splitHeaders(rawText);
  const headers = headersOf(headerText);
  const ct = parseHeaderParams(headers['content-type'] || 'text/plain');
  const cte = headers['content-transfer-encoding'];

  if (ct.value.startsWith('multipart/') && ct.params.boundary && depth < 5) {
    const boundary = '--' + ct.params.boundary;
    const segs = bodyText.split(new RegExp(boundary + '(?:--)?[ \\t]*\\r?\\n'));
    for (const seg of segs) {
      if (!seg || /^--\s*$/.test(seg)) continue;
      parsePart(seg.replace(/\r?\n$/, ''), depth + 1, out);
    }
    return out;
  }

  const disposition = parseHeaderParams(headers['content-disposition'] || '');
  const isAttachment = disposition.value === 'attachment' || !!ct.params.name;

  // CTE 只解一次；8bit/7bit 的 bodyText 已是 UTF-8 字符串，直接用
  // （注意不能用 Buffer.from(str,'binary')：charCode>255 会截断，多字节文本全毁）
  const enc = (cte || '').toLowerCase();
  let decoded;
  let bodyBuf;
  if (enc === 'base64') {
    bodyBuf = Buffer.from(bodyText.replace(/\s+/g, ''), 'base64');
    decoded = toText(bodyBuf, ct.params.charset);
  } else if (enc === 'quoted-printable') {
    bodyBuf = Buffer.from(decodeQuotedPrintable(bodyText), 'binary');
    decoded = toText(bodyBuf, ct.params.charset);
  } else {
    decoded = bodyText;
    bodyBuf = Buffer.from(bodyText, 'utf8');
  }

  if (isAttachment || ((ct.value.startsWith('image/') || ct.value.startsWith('application/')) && depth > 0)) {
    out.attachments.push({
      filename: disposition.params.filename || ct.params.name || 'unnamed',
      contentType: ct.value,
      size: bodyBuf.length,
    });
  } else if (ct.value === 'text/html') {
    out.htmlParts.push(decoded);
  } else {
    out.textParts.push(decoded);
  }
  return out;
}

// 地址形如 `Name <a@b.c>` / `<a@b.c>` / `a@b.c` → a@b.c
export function addrOf(v = '') {
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim();
}

export function parseMessage(raw /* Buffer|string */) {
  const rawText = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  const [headerText] = splitHeaders(rawText);
  const top = headersOf(headerText);
  const parsed = parsePart(rawText);
  const text = parsed.textParts.join('\n').trim();
  const html = parsed.htmlParts.join('\n').trim();
  return {
    messageId: top['message-id'] || '',
    from: top.from ? addrOf(top.from) : '',
    fromName: top.from && /^([^<]+)</.test(top.from) ? decodeEncodedWords(RegExp.$1).replace(/["']/g, '').trim() : '',
    to: top.to || '',
    subject: (top.subject || '(无主题)').trim(),
    date: top.date ? new Date(top.date).toISOString() || '' : new Date().toISOString(),
    text,
    html,
    attachments: parsed.attachments,
  };
}
