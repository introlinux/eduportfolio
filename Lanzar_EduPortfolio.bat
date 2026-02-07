@echo off
echo Iniciando EduPortfolio Desktop...
cd /d %~dp0
npm run electron:dev
pause
