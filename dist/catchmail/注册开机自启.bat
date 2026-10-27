@echo off
chcp 65001 >nul
set "EXE=%~dp0catchmail.exe"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\catchmail.lnk'); $s.TargetPath='%EXE%'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
if %errorlevel%==0 (echo 已注册：登录 Windows 后自动最小化启动 catchmail) else (echo 注册失败，请右键本文件“以管理员身份运行”)
pause
