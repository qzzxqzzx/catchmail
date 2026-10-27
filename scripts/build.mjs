// build.mjs — 一键构建 Windows 便携版：
//   esbuild 打单文件 → Node SEA 注入 → 组装 dist/catchmail/ → 压缩 dist/catchmail-portable-win-x64.zip
// 用法：npm run build   （需 devDependencies：esbuild、postject；本机需 Node 20+）
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const APP = join(DIST, 'catchmail');
const exe = (c) => execSync(c, { cwd: ROOT, stdio: 'inherit' });

console.log('① esbuild 打包单文件');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });
exe(`npx esbuild src/server.js --bundle --platform=node --format=cjs --outfile=dist/app.cjs --log-level=warning`);

console.log('② 生成 SEA blob');
writeFileSync(join(DIST, 'sea-config.json'), JSON.stringify({
  main: 'dist/app.cjs',
  output: 'dist/sea.blob',
  disableExperimentalSEAWarning: true,
}));
exe(`node --experimental-sea-config dist/sea-config.json`);

console.log('③ 复制 Node 运行时为 catchmail.exe 并注入 blob');
const nodeExe = process.execPath;
copyFileSync(nodeExe, join(APP, 'catchmail.exe'));
exe(`npx postject dist/catchmail/catchmail.exe NODE_SEA_BLOB dist/sea.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`);

console.log('④ 组装便携目录');
copyFileSync(join(ROOT, 'scripts', '使用说明.txt'), join(APP, '使用说明.txt'));
copyFileSync(join(ROOT, 'scripts', '注册开机自启.bat'), join(APP, '注册开机自启.bat'));
copyFileSync(join(ROOT, 'scripts', '取消开机自启.bat'), join(APP, '取消开机自启.bat'));
mkdirSync(join(APP, 'public'), { recursive: true });
copyFileSync(join(ROOT, 'public', 'index.html'), join(APP, 'public', 'index.html'));
// 首次运行模板配置（domains 占位，用户自己改）
writeFileSync(join(APP, 'config.json'), JSON.stringify({
  domains: ['example.com'], smtpPort: 25, smtpHost: '0.0.0.0',
  httpPort: 8025, httpHost: '127.0.0.1',
  maxMessageBytes: 10485760, maxPerBox: 500, dataDir: 'data',
}, null, 2) + '\n');

console.log('⑤ 压缩便携包');
const zip = join(DIST, 'catchmail-portable-win-x64.zip');
rmSync(zip, { force: true });
exe(`powershell -NoProfile -Command "Compress-Archive -Path 'dist/catchmail/*' -DestinationPath 'dist/catchmail-portable-win-x64.zip'"`);
if (!existsSync(zip)) { console.error('压缩失败'); process.exit(1); }

console.log(`\n完成：dist/catchmail/（绿色目录）与 dist/catchmail-portable-win-x64.zip`);
