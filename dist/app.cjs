var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/server.js
var import_node_fs4 = require("node:fs");
var import_node_child_process = require("node:child_process");
var import_node_path4 = require("node:path");

// src/util.js
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var arg1 = process.argv[1] ? (0, import_node_path.resolve)(process.argv[1]) : "";
var IS_SEA = !arg1 || arg1 === (0, import_node_path.resolve)(process.execPath);
var APP_DIR = IS_SEA ? (0, import_node_path.dirname)(process.execPath) : (0, import_node_fs.existsSync)((0, import_node_path.join)(process.cwd(), "package.json")) ? process.cwd() : (0, import_node_path.dirname)((0, import_node_path.dirname)(arg1));
function log(...a) {
  const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${a.join(" ")}`;
  console.log(line);
  if (log.file) {
    try {
      if ((0, import_node_fs.statSync)(log.file).size > 5 * 1024 * 1024) (0, import_node_fs.truncateSync)(log.file, 0);
    } catch {
    }
    try {
      (0, import_node_fs.appendFileSync)(log.file, line + "\n");
    } catch {
    }
  }
}
log.file = "";
function newId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
var DEFAULTS = {
  domains: ["example.com"],
  // 接收这些域名的所有地址（catch-all）
  smtpPort: 25,
  // 生产 25；开发可用 2525
  smtpHost: "0.0.0.0",
  httpPort: 8025,
  httpHost: "127.0.0.1",
  // Web 界面默认只听本机，需要局域网访问再改
  maxMessageBytes: 10 * 1024 * 1024,
  maxPerBox: 500,
  // 每个收件箱保留条数
  dataDir: (0, import_node_path.join)(APP_DIR, "data")
};
function loadConfig() {
  const cliArg = process.argv.find((a) => a.startsWith("--config="));
  const cfgPath = cliArg?.slice(9) || process.env.CM_CONFIG || (0, import_node_path.join)(APP_DIR, "config.json");
  let fileCfg = {};
  const exists = cfgPath && (0, import_node_fs.existsSync)(cfgPath);
  if (exists) {
    try {
      fileCfg = JSON.parse((0, import_node_fs.readFileSync)(cfgPath, "utf8"));
    } catch (e) {
      console.error(`config.json \u89E3\u6790\u5931\u8D25\uFF08${e.message}\uFF09\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u914D\u7F6E`);
    }
  }
  const cfg2 = { ...DEFAULTS, ...fileCfg, configPath: cfgPath, configExisted: exists };
  cfg2.domains = (cfg2.domains || []).map((d) => String(d).toLowerCase().replace(/^\*\./, ""));
  if (!cfg2.domains.length) cfg2.domains = DEFAULTS.domains;
  return cfg2;
}
function domainMatches(host, domains) {
  const h = String(host || "").toLowerCase();
  return domains.some((d) => h === d || h.endsWith("." + d));
}

// src/smtp.js
var import_node_net = __toESM(require("node:net"), 1);
function startSmtp({ port, host, domains, maxBytes }, onMessage2) {
  const server = import_node_net.default.createServer((sock) => {
    const peer = `${sock.remoteAddress}:${sock.remotePort}`;
    let buf = Buffer.alloc(0);
    let state = "CMD";
    let mailFrom = "";
    let rcpts = [];
    let dataBuf = [];
    let dataBytes = 0;
    const reply = (line) => sock.write(line + "\r\n");
    log(`[smtp] \u8FDE\u63A5 ${peer}`);
    reply("220 catchmail ready");
    const resetTx = () => {
      mailFrom = "";
      rcpts = [];
    };
    const finish = () => {
      const raw = Buffer.concat(dataBuf);
      dataBuf = [];
      dataBytes = 0;
      const rec = onMessage2({ mailFrom, rcptTos: rcpts, raw, peer });
      resetTx();
      reply(`250 OK id=${rec?.id || "dropped"}`);
      state = "CMD";
    };
    const handleCommand = (line) => {
      const verb = line.slice(0, 4).toUpperCase();
      if (verb === "EHLO") {
        reply("250-catchmail greeting " + peer);
        reply("250-8BITMIME");
        reply("250-SIZE " + maxBytes);
        reply("250 OK");
      } else if (verb === "HELO") {
        reply("250 catchmail greeting " + peer);
      } else if (verb === "MAIL") {
        const m = line.match(/^MAIL\s+FROM:\s*<?([^>]*)>?/i);
        if (!m) return reply("501 syntax: MAIL FROM:<addr>");
        resetTx();
        mailFrom = m[1].trim();
        reply("250 OK");
      } else if (verb === "RCPT") {
        const m = line.match(/^RCPT\s+TO:\s*<?([^>]*)>?/i);
        if (!m) return reply("501 syntax: RCPT TO:<addr>");
        const addr = m[1].trim();
        const domain = addr.split("@")[1] || "";
        if (!domainMatches(domain, domains)) return reply(`550 we do not relay <${domain}>`);
        if (rcpts.length >= 10) return reply("452 too many recipients");
        rcpts.push(addr.toLowerCase());
        reply("250 OK");
      } else if (verb === "DATA") {
        if (!rcpts.length) return reply("503 need RCPT first");
        state = "DATA";
        reply("354 end data with <CRLF>.<CRLF>");
      } else if (verb === "RSET") {
        resetTx();
        reply("250 OK");
      } else if (verb === "NOOP") {
        reply("250 OK");
      } else if (verb === "QUIT") {
        reply("221 bye");
        state = "DONE";
        sock.end();
      } else reply("500 command not recognized");
    };
    const handleDataLine = (lineBuf) => {
      if (lineBuf.toString("binary") === ".") {
        finish();
        return;
      }
      const unstuffed = lineBuf.toString("binary").startsWith("..") ? lineBuf.slice(1) : lineBuf;
      dataBytes += unstuffed.length;
      if (dataBytes > maxBytes) {
        reply("552 message exceeds fixed maximum size");
        state = "CMD";
        dataBuf = [];
        dataBytes = 0;
        resetTx();
        return;
      }
      dataBuf.push(Buffer.concat([unstuffed, Buffer.from("\r\n")]));
    };
    sock.on("data", (chunk) => {
      if (state === "DONE") return;
      buf = Buffer.concat([buf, chunk]);
      let idx;
      while ((idx = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (state === "DATA") handleDataLine(line);
        else handleCommand(line.toString("utf8").replace(/\r$/, ""));
      }
    });
    sock.setTimeout(12e4, () => {
      reply("421 timeout");
      sock.destroy();
    });
    sock.on("error", () => {
    });
    sock.on("close", () => log(`[smtp] \u65AD\u5F00 ${peer}`));
  });
  return new Promise((resolve2, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      log(`[smtp] \u76D1\u542C ${host}:${port}\uFF0C\u63A5\u6536\u57DF: ${domains.join(", ")}`);
      resolve2(server);
    });
  });
}

// src/http.js
var import_node_http = require("node:http");
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
function startHttp({ port, host, store: store2, publicDir }) {
  const server = (0, import_node_http.createServer)((req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;
    try {
      if (path === "/api/boxes") return json(res, store2.boxes());
      if (path === "/api/messages") {
        return json(res, store2.list({
          box: url.searchParams.get("box") || void 0,
          q: url.searchParams.get("q") || void 0,
          limit: Math.min(+url.searchParams.get("limit") || 200, 1e3)
        }));
      }
      const m = path.match(/^\/api\/messages\/([\w-]+)(\/(raw))?$/);
      if (m) {
        const [, id, , what] = m;
        const rec = store2.get(id);
        if (!rec) return json(res, { error: "not found" }, 404);
        if (req.method === "DELETE") return json(res, { ok: store2.delete(id) });
        if (what === "raw") {
          const f = (0, import_node_path2.join)(store2.rawDir, id + ".eml");
          if (!(0, import_node_fs2.existsSync)(f)) return json(res, { error: "no raw" }, 404);
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end((0, import_node_fs2.readFileSync)(f));
        }
        return json(res, rec);
      }
      if (path === "/api/clear" && req.method === "POST") {
        store2.clear(url.searchParams.get("box") || void 0);
        return json(res, { ok: true });
      }
      if (path === "/" || path === "/index.html") {
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        return res.end((0, import_node_fs2.readFileSync)((0, import_node_path2.join)(publicDir, "index.html")));
      }
      const staticFile = (0, import_node_path2.join)(publicDir, path.replace(/\.\./g, ""));
      if ((0, import_node_fs2.existsSync)(staticFile)) {
        res.writeHead(200, { "Content-Type": MIME[staticFile.slice(staticFile.lastIndexOf("."))] || "application/octet-stream" });
        return res.end((0, import_node_fs2.readFileSync)(staticFile));
      }
      json(res, { error: "not found" }, 404);
    } catch (e) {
      log("[http] \u9519\u8BEF", e.message);
      json(res, { error: e.message }, 500);
    }
  });
  return new Promise((resolve2, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      log(`[http] \u6536\u4EF6\u7BB1 http://${host}:${port}`);
      resolve2(server);
    });
  });
}
function json(res, data, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

// src/store.js
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");
var CODE_BEFORE = /(?:验证码|校验码|驗證碼|verification code|security code|confirm(?:ation)? code|otp|passcode|pin code|code is|code:)\D{0,24}?(\d{4,8})/i;
var CODE_AFTER = /(\d{4,8})\D{0,24}?(?:是你的验证码|为验证码|是您的验证码|is your (?:verification |security )?code)/i;
var CODE_STANDALONE = /(?:^|\D)(\d{4,8})(?:\D|$)/;
function extractCode(subject = "", text = "") {
  const hay = `${subject}
${text}`.slice(0, 8e3);
  const short = hay.length < 400;
  const m = hay.match(CODE_BEFORE) || hay.match(CODE_AFTER) || (short && /码|code|otp/i.test(hay) ? hay.match(CODE_STANDALONE) : null);
  return m ? m[1] : null;
}
var Store = class {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = (0, import_node_path3.join)(dataDir, "messages.jsonl");
    this.rawDir = (0, import_node_path3.join)(dataDir, "raw");
    this.map = /* @__PURE__ */ new Map();
    this.order = [];
  }
  load() {
    (0, import_node_fs3.mkdirSync)(this.rawDir, { recursive: true });
    if (!(0, import_node_fs3.existsSync)(this.file)) return;
    for (const line of (0, import_node_fs3.readFileSync)(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.deleted) {
          this.map.delete(rec.id);
          this.order = this.order.filter((x) => x !== rec.id);
          continue;
        }
        this.map.set(rec.id, rec);
        if (!this.order.includes(rec.id)) this.order.unshift(rec.id);
      } catch {
      }
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
      fromName: mail.fromName || "",
      subject: mail.subject,
      date: mail.date,
      text: (mail.text || "").slice(0, 1e5),
      hasHtml: !!mail.html,
      html: (mail.html || "").slice(0, 5e5),
      attachments: mail.attachments || [],
      code: extractCode(mail.subject, mail.text || stripHtml(mail.html)),
      size: mail.size || 0
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
  get(id) {
    return this.map.get(id) || null;
  }
  list({ box, q, limit = 200 } = {}) {
    let ids = this.order;
    if (box) ids = ids.filter((id) => this.map.get(id)?.box === box);
    let items = ids.map((id) => this.map.get(id)).filter(Boolean);
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((r) => r.subject.toLowerCase().includes(needle) || r.from.toLowerCase().includes(needle) || r.to.toLowerCase().includes(needle) || r.text.toLowerCase().includes(needle));
    }
    return items.slice(0, limit).map(preview);
  }
  boxes() {
    const counts = /* @__PURE__ */ new Map();
    for (const id of this.order) {
      const r = this.map.get(id);
      counts.set(r.box, (counts.get(r.box) || 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }
  delete(id) {
    if (!this.map.has(id)) return false;
    this.map.delete(id);
    this.order = this.order.filter((x) => x !== id);
    appendLine(this.file, JSON.stringify({ deleted: true, id }));
    try {
      (0, import_node_fs3.unlinkSync)((0, import_node_path3.join)(this.rawDir, id + ".eml"));
    } catch {
    }
    return true;
  }
  clear(box) {
    for (const id of [...this.order]) {
      if (!box || this.map.get(id)?.box === box) this.delete(id);
    }
  }
  count() {
    return this.order.length;
  }
};
function preview(r) {
  return { ...r, html: void 0, text: (r.text || "").slice(0, 300) };
}
function appendLine(file, line) {
  (0, import_node_fs3.appendFileSync)(file, line + "\n");
}
function stripHtml(html = "") {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
}

// src/parse.js
var HDR_BODY_SPLIT = /\r?\n\r?\n/;
function unfoldHeaders(headerText) {
  const lines = headerText.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += " " + line.trim();
    else out.push(line);
  }
  return out;
}
function parseHeaderLine(line) {
  const i = line.indexOf(":");
  if (i <= 0) return null;
  return [line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()];
}
function parseHeaderParams(v = "") {
  const segs = v.split(";");
  const value = segs[0].trim().toLowerCase();
  const params = {};
  for (const seg of segs.slice(1)) {
    const m = seg.match(/^\s*([\w-]+)\s*=\s*(.*)\s*$/);
    if (m) params[m[1].toLowerCase()] = m[2].replace(/^"|"$/g, "");
  }
  return { value, params };
}
function decodeWord(charset, enc, data) {
  try {
    const buf = enc.toUpperCase() === "B" ? Buffer.from(data, "base64") : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "binary");
    return new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    return data;
  }
}
var decodeEncodedWords = (s = "") => s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, data) => decodeWord(cs, enc, data)).replace(/\?=\s+=\?/g, "?==?");
function decodeQuotedPrintable(s) {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function toText(buf, charset) {
  try {
    return new TextDecoder((charset || "utf-8").toLowerCase()).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}
function splitHeaders(raw) {
  const m = raw.match(HDR_BODY_SPLIT);
  if (!m) return [raw, ""];
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
function parsePart(rawText, depth = 0, out = { textParts: [], htmlParts: [], attachments: [] }) {
  const [headerText, bodyText] = splitHeaders(rawText);
  const headers = headersOf(headerText);
  const ct = parseHeaderParams(headers["content-type"] || "text/plain");
  const cte = headers["content-transfer-encoding"];
  if (ct.value.startsWith("multipart/") && ct.params.boundary && depth < 5) {
    const boundary = "--" + ct.params.boundary;
    const segs = bodyText.split(new RegExp(boundary + "(?:--)?[ \\t]*\\r?\\n"));
    for (const seg of segs) {
      if (!seg || /^--\s*$/.test(seg)) continue;
      parsePart(seg.replace(/\r?\n$/, ""), depth + 1, out);
    }
    return out;
  }
  const disposition = parseHeaderParams(headers["content-disposition"] || "");
  const isAttachment = disposition.value === "attachment" || !!ct.params.name;
  const enc = (cte || "").toLowerCase();
  let decoded;
  let bodyBuf;
  if (enc === "base64") {
    bodyBuf = Buffer.from(bodyText.replace(/\s+/g, ""), "base64");
    decoded = toText(bodyBuf, ct.params.charset);
  } else if (enc === "quoted-printable") {
    bodyBuf = Buffer.from(decodeQuotedPrintable(bodyText), "binary");
    decoded = toText(bodyBuf, ct.params.charset);
  } else {
    decoded = bodyText;
    bodyBuf = Buffer.from(bodyText, "utf8");
  }
  if (isAttachment || (ct.value.startsWith("image/") || ct.value.startsWith("application/")) && depth > 0) {
    out.attachments.push({
      filename: disposition.params.filename || ct.params.name || "unnamed",
      contentType: ct.value,
      size: bodyBuf.length
    });
  } else if (ct.value === "text/html") {
    out.htmlParts.push(decoded);
  } else {
    out.textParts.push(decoded);
  }
  return out;
}
function addrOf(v = "") {
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim();
}
function parseMessage(raw) {
  const rawText = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  const [headerText] = splitHeaders(rawText);
  const top = headersOf(headerText);
  const parsed = parsePart(rawText);
  const text = parsed.textParts.join("\n").trim();
  const html = parsed.htmlParts.join("\n").trim();
  return {
    messageId: top["message-id"] || "",
    from: top.from ? addrOf(top.from) : "",
    fromName: top.from && /^([^<]+)</.test(top.from) ? decodeEncodedWords(RegExp.$1).replace(/["']/g, "").trim() : "",
    to: top.to || "",
    subject: (top.subject || "(\u65E0\u4E3B\u9898)").trim(),
    date: top.date ? new Date(top.date).toISOString() || "" : (/* @__PURE__ */ new Date()).toISOString(),
    text,
    html,
    attachments: parsed.attachments
  };
}

// src/server.js
var cfg = loadConfig();
(0, import_node_fs4.mkdirSync)(cfg.dataDir, { recursive: true });
log.file = (0, import_node_path4.join)(cfg.dataDir, "catchmail.log");
if (!cfg.configExisted) {
  const template = { ...cfg };
  delete template.configPath;
  delete template.configExisted;
  (0, import_node_fs4.writeFileSync)(cfg.configPath, JSON.stringify(template, null, 2) + "\n");
  log(`[init] \u5DF2\u751F\u6210\u9ED8\u8BA4\u914D\u7F6E ${cfg.configPath} \u2014\u2014 \u628A domains \u6539\u6210\u4F60\u7684\u57DF\u540D\u5E76\u91CD\u542F\u5373\u53EF\u6B63\u5F0F\u6536\u4FE1`);
}
var store = new Store(cfg.dataDir);
store.load();
log(`[store] \u5DF2\u6062\u590D ${store.count()} \u5C01\u90AE\u4EF6`);
async function onMessage({ mailFrom, rcptTos, raw, peer }) {
  try {
    const msg = parseMessage(raw);
    const primary = addrOf(rcptTos[0] || "");
    const box = (primary.split("@")[0] || "catchall").toLowerCase();
    const rec = store.add({ ...msg, box, rcptTo: rcptTos.join(", "), size: raw.length }, cfg.maxPerBox);
    (0, import_node_fs4.writeFileSync)((0, import_node_path4.join)(store.rawDir, rec.id + ".eml"), raw);
    log(`[smtp] ${peer} \u6536\u4FE1 \u2192 ${box}: "${rec.subject}" \u81EA ${rec.from}\uFF08${raw.length}B${rec.code ? "\uFF0C\u9A8C\u8BC1\u7801 " + rec.code : ""}\uFF09`);
    return rec;
  } catch (e) {
    log("[smtp] \u5165\u5E93\u5931\u8D25:", e.message);
    return null;
  }
}
var openBrowser = (url) => {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  (0, import_node_child_process.exec)(cmd, { shell: true }, () => {
  });
};
var wantOpen = !process.argv.includes("--no-open");
async function main() {
  let httpBound = false;
  try {
    await startSmtp({ port: cfg.smtpPort, host: cfg.smtpHost, domains: cfg.domains, maxBytes: cfg.maxMessageBytes }, onMessage);
    await startHttp({ port: cfg.httpPort, host: cfg.httpHost, store, publicDir: (0, import_node_path4.join)(APP_DIR, "public") });
    httpBound = true;
  } catch (e) {
    if (e.code === "EADDRINUSE" && String(e.message).includes(String(cfg.httpPort))) {
      log(`[hint] \u7AEF\u53E3 ${cfg.httpPort} \u5DF2\u88AB\u5360\u7528\u2014\u2014\u53EF\u80FD\u5DF2\u6709\u4E00\u4E2A catchmail \u6B63\u5728\u8FD0\u884C\uFF0C\u76F4\u63A5\u6253\u5F00\u5B83`);
      if (wantOpen) openBrowser(`http://${cfg.httpHost === "0.0.0.0" ? "127.0.0.1" : cfg.httpHost}:${cfg.httpPort}`);
      process.exit(0);
    }
    log(`[fatal] \u542F\u52A8\u5931\u8D25: ${e.message}${e.code === "EADDRINUSE" ? "\uFF08\u6539 config.json \u7684 smtpPort/httpPort\uFF09" : ""}`);
    process.exit(1);
  }
  const shownHttp = `http://${cfg.httpHost === "0.0.0.0" ? "127.0.0.1" : cfg.httpHost}:${cfg.httpPort}`;
  console.log(`
  catchmail ${IS_SEA ? "(\u8F6F\u4EF6\u7248)" : "(\u5F00\u53D1\u7248)"} \u5DF2\u5C31\u7EEA
  \u6536\u4EF6\u57DF\u540D : ${cfg.domains.join(", ")}
  SMTP     : ${cfg.smtpHost}:${cfg.smtpPort}  \uFF08MX \u8BB0\u5F55\u6307\u5230\u672C\u673A\u5373\u53EF\u6536\u4FE1\uFF09
  \u6536\u4EF6\u7BB1   : ${shownHttp}
  \u6570\u636E\u76EE\u5F55 : ${cfg.dataDir}
  \u5173\u95ED\u672C\u7A97\u53E3/\u8FDB\u7A0B = \u505C\u6B62\u6536\u4FE1\uFF1B\u65E5\u5FD7\u5728 data/catchmail.log
`);
  if (wantOpen) openBrowser(shownHttp);
  return httpBound;
}
main();
