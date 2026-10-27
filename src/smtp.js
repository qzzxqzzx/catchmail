// smtp.js — 极简 SMTP 接收服务器（RFC 5321 子集）：catch-all 收下配置域名的所有邮件
// 支持 EHLO/HELO/MAIL/RCPT/DATA/RSET/NOOP/QUIT；不实现转发、认证与 TLS（纯收件器）
import net from 'node:net';
import { domainMatches, log } from './util.js';

export function startSmtp({ port, host, domains, maxBytes }, onMessage) {
  const server = net.createServer((sock) => {
    const peer = `${sock.remoteAddress}:${sock.remotePort}`;
    let buf = Buffer.alloc(0);
    let state = 'CMD';               // CMD | DATA | DONE
    let mailFrom = '';
    let rcpts = [];
    let dataBuf = [];
    let dataBytes = 0;

    const reply = (line) => sock.write(line + '\r\n');
    log(`[smtp] 连接 ${peer}`);
    reply('220 catchmail ready');

    const resetTx = () => { mailFrom = ''; rcpts = []; };
    const finish = () => {
      const raw = Buffer.concat(dataBuf);
      dataBuf = []; dataBytes = 0;
      const rec = onMessage({ mailFrom, rcptTos: rcpts, raw, peer });
      resetTx();
      reply(`250 OK id=${rec?.id || 'dropped'}`);
      state = 'CMD';
    };

    const handleCommand = (line) => {
      const verb = line.slice(0, 4).toUpperCase();
      if (verb === 'EHLO') {
        reply('250-catchmail greeting ' + peer);
        reply('250-8BITMIME');
        reply('250-SIZE ' + maxBytes);
        reply('250 OK');
      } else if (verb === 'HELO') {
        reply('250 catchmail greeting ' + peer);
      } else if (verb === 'MAIL') {
        const m = line.match(/^MAIL\s+FROM:\s*<?([^>]*)>?/i);
        if (!m) return reply('501 syntax: MAIL FROM:<addr>');
        resetTx();
        mailFrom = m[1].trim();
        reply('250 OK');
      } else if (verb === 'RCPT') {
        const m = line.match(/^RCPT\s+TO:\s*<?([^>]*)>?/i);
        if (!m) return reply('501 syntax: RCPT TO:<addr>');
        const addr = m[1].trim();
        const domain = addr.split('@')[1] || '';
        if (!domainMatches(domain, domains)) return reply(`550 we do not relay <${domain}>`);
        if (rcpts.length >= 10) return reply('452 too many recipients');
        rcpts.push(addr.toLowerCase());
        reply('250 OK');
      } else if (verb === 'DATA') {
        if (!rcpts.length) return reply('503 need RCPT first');
        state = 'DATA';
        reply('354 end data with <CRLF>.<CRLF>');
      } else if (verb === 'RSET') { resetTx(); reply('250 OK'); }
      else if (verb === 'NOOP') { reply('250 OK'); }
      else if (verb === 'QUIT') { reply('221 bye'); state = 'DONE'; sock.end(); }
      else reply('500 command not recognized');
    };

    // DATA 模式：按行扫，处理 dot-stuffing 与 <CRLF>.<CRLF> 终止符
    const handleDataLine = (lineBuf) => {
      if (lineBuf.toString('binary') === '.') {
        finish();
        return;
      }
      const unstuffed = lineBuf.toString('binary').startsWith('..') ? lineBuf.slice(1) : lineBuf;
      dataBytes += unstuffed.length;
      if (dataBytes > maxBytes) {
        reply('552 message exceeds fixed maximum size');
        state = 'CMD';
        dataBuf = []; dataBytes = 0;
        resetTx();
        return;
      }
      dataBuf.push(Buffer.concat([unstuffed, Buffer.from('\r\n')]));
    };

    sock.on('data', (chunk) => {
      if (state === 'DONE') return;
      buf = Buffer.concat([buf, chunk]);
      let idx;
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (state === 'DATA') handleDataLine(line);
        else handleCommand(line.toString('utf8').replace(/\r$/, ''));
      }
    });

    sock.setTimeout(120_000, () => { reply('421 timeout'); sock.destroy(); });
    sock.on('error', () => {});
    sock.on('close', () => log(`[smtp] 断开 ${peer}`));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { log(`[smtp] 监听 ${host}:${port}，接收域: ${domains.join(', ')}`); resolve(server); });
  });
}
