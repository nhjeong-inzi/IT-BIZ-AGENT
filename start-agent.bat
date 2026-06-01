@echo off
chcp 65001 > nul
title IT-BIZ-AGENT

:: 이미 서버가 실행 중인지 확인
netstat -ano | findstr ":3001 " | findstr "LISTENING" > nul 2>&1
if %errorlevel%==0 (
    echo [IT-BIZ-AGENT] 서버가 이미 실행 중입니다.
    start "" "http://localhost:3001/"
    exit /b
)

:: 서버 실행
echo [IT-BIZ-AGENT] 서버를 시작합니다...
cd /d "%~dp0"
start "" /min cmd /c "node --env-file=.env server/index.js"

:: 서버 기동 대기 (최대 10초)
set count=0
:wait
timeout /t 1 /nobreak > nul
netstat -ano | findstr ":3001 " | findstr "LISTENING" > nul 2>&1
if %errorlevel%==0 goto open
set /a count+=1
if %count% lss 10 goto wait

:open
echo [IT-BIZ-AGENT] 브라우저를 엽니다...
start "" "http://localhost:3001/"
