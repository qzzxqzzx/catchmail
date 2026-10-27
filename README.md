# catchmail · 域名邮箱接收器

给自己的域名做一个「收件口」：**任何发到 `*@你的域名` 的邮件都被收下来**，打开网页就能看，验证码自动提取高亮。零依赖，单进程，Node 18+ 直接跑。

## 软件版（Windows，双击即用）

不想装 Node？直接下便携包：[Release v0.2.0 · catchmail-portable-win-x64.zip](https://github.com/qzzxqzzx/catchmail/releases/download/v0.2.0/catchmail-portable-win-x64.zip)（约 35MB）

- 解压后双击 `catchmail.exe`：首跑自动生成 `config.json`，自动打开浏览器收件箱
- 把 `config.json` 里 `domains` 改成你的域名并重启，即完成配置
- `注册开机自启.bat` = 登录后自动最小化启动；重复双击 exe 会自动打开已运行实例的页面
- 自己构建：`npm run dist`（测试 + esbuild 单文件 + Node SEA 注入 + zip），产物在 `dist/`

```
发件方 ──SMTP──▶ catchmail(25端口) ──▶ data/messages.jsonl（追加落盘）
                                        ▲
浏览器 ◀──Web 收件箱(8025端口)──────────┘  验证码自动提取 / HTML 预览 / 原文下载
```

## 特性

- **Catch-all 收信**：实现 RFC 5321 子集的 SMTP 服务器，配置的域名（含子域）来者不拒，其它域一律 `550` 拒收
- **Web 收件箱**：按收件地址分箱（RCPT TO 的本地部分）、搜索、HTML 沙箱预览、原文 .eml 下载、5 秒自动刷新
- **验证码自动提取**：中英文模式匹配（验证码 / verification code / OTP / code is…），列表与详情页直接高亮
- **追加式存储**：JSONL 追加落盘 + 启动重放恢复，断电最多丢最后一行；原文逐封存 `data/raw/*.eml`
- **零依赖**：只用 Node 内置模块，`npm test` 即端到端冒烟（真实起服务 → SMTP 投信 → API 断言 14 项）

## 快速开始

```bash
git clone <本仓库> && cd catchmail
cp config.example.json config.json   # 改 domains 为你的域名
npm test                             # 先跑端到端测试（随机端口，不碰生产配置）
npm start
```

开发机（无 25 端口权限）把 `smtpPort` 改成 `2525`，本地投信测试：

```bash
node -e "const net=require('net');const s=net.connect(2525,'127.0.0.1',()=>{s.write('EHLO t\r\n')});s.on('data',d=>{process.stdout.write(d);s.write(['MAIL FROM: <a@b.c>','RCPT TO: <me@yourdomain.com>','DATA','Subject: hi\r\n\r\ncode 123456','.','QUIT',''].shift()+'\r\n')})"
```

## 收到真邮件的 DNS 配置（VPS 部署）

1. 域名 **MX 记录** → 你的服务器 IP 或主机名（优先级 10）
2. **SPF**：`v=spf1 mx ~all`（TXT）
3. **DMARC**（可选）：`_dmarc` TXT `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`
4. 云厂商安全组/防火墙放行 **TCP 25 入站**（部分云默认封 25，需申请解封；家庭宽带基本不可行）

systemd 单元示例：

```ini
# /etc/systemd/system/catchmail.service
[Unit]
After=network.target
[Service]
WorkingDirectory=/opt/catchmail
ExecStart=/usr/bin/node src/server.js
Restart=always
User=catchmail
[Install]
WantedBy=multi-user.target
```

**端口 25 被云封死时的替代路线**：用 Cloudflare Email Routing 把 `*@域名` 转发到某个真实邮箱，再把本工具指向的域换成真实邮箱所在域无法实现（本工具只收直投 SMTP）——此时可把 Cloudflare Worker 路由方案作为补充，或换一家不封 25 的 VPS。

## 配置项（config.json）

| 字段 | 默认 | 说明 |
|---|---|---|
| `domains` | `["example.com"]` | 接收的域名（精确 + 子域匹配） |
| `smtpPort` / `smtpHost` | 25 / 0.0.0.0 | SMTP 监听 |
| `httpPort` / `httpHost` | 8025 / 127.0.0.1 | Web 收件箱（默认只听本机） |
| `maxMessageBytes` | 10MB | 单封大小上限，超限 `552` |
| `maxPerBox` | 500 | 每个收件箱保留条数（超出自动删最旧） |
| `dataDir` | `./data` | 存储目录 |

## HTTP API

```
GET    /api/boxes                      收件箱列表（名称+计数）
GET    /api/messages?box=&q=&limit=    邮件列表（box 过滤、q 搜索）
GET    /api/messages/:id               邮件详情（含 code 提取结果）
GET    /api/messages/:id/raw           原始 .eml
DELETE /api/messages/:id               删除
POST   /api/clear?box=                 清空（可指定箱）
```

## 安全边界（务必了解）

- 这是**收件器**，不是邮件服务器：无 TLS（STARTTLS 未实现）、无认证、不外发、不转发。中继检查（`550 we do not relay`）保证它不会帮别人转发邮件。
- HTML 预览在 `sandbox` iframe 里渲染（脚本不执行）；邮件原文原样落盘。
- `httpHost` 默认 `127.0.0.1`；要局域网/公网访问 Web 界面请自行加反代与认证。

## 已知边界

- 非 base64/QP 的 8bit 正文按 UTF-8 解释（现代邮件基本都走 base64/QP 或 UTF-8，够用）
- 地址解析取 `<>` 内地址；不处理复杂的 group 语法
- 附件只记录元信息（文件名/类型/大小），不提供下载（验证码场景用不到）

## 测试

```bash
npm test   # 端到端：起真实服务 → SMTP 投 3 封信（multipart/验证码/附件/拒收）→ 14 项 API 断言
```

Windows 下父进程退出码正确（0/1）；子进程被强杀时控制台可能打印一行 libuv 断言噪音，不影响结果。
