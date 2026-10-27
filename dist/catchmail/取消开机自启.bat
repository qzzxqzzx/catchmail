@echo off
chcp 65001 >nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\catchmail.lnk" 2>nul
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\catchmail.lnk" (echo 取消失败) else (echo 已取消开机自启)
pause
