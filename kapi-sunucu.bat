@echo off
title Kapi Sunucu
cd /d "%~dp0apps\server"
:loop
node --import tsx src/index.ts
echo.
echo Sunucu durdu. 5 saniye sonra yeniden baslatilacak. Kapatmak icin bu pencereyi kapat.
timeout /t 5 /nobreak >nul
goto loop