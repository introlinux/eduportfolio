@echo off
echo ========================================
echo  Compilacion limpia de EduPortfolio
echo ========================================
echo.

REM Limpiar carpeta dist/
echo [1/5] Limpiando carpeta dist/...
if exist dist\ (
    rmdir /s /q dist\
    echo   - dist/ eliminada
) else (
    echo   - dist/ no existe, omitiendo
)

REM Hacer backup temporal de data/
echo [2/5] Haciendo backup de data/...
if exist data\ (
    move data data_temp_backup >nul 2>&1
    echo   - data/ movida a data_temp_backup/
) else (
    echo   - data/ no existe, omitiendo
)

REM Hacer backup temporal de portfolios/
echo [3/5] Haciendo backup de portfolios/...
if exist portfolios\ (
    move portfolios portfolios_temp_backup >nul 2>&1
    echo   - portfolios/ movida a portfolios_temp_backup/
) else (
    echo   - portfolios/ no existe, omitiendo
)

REM Compilar
echo [4/5] Compilando ejecutables para Windows y Linux...
echo.
call npm run electron:build:all
echo.

REM Restaurar backups
echo [5/5] Restaurando backups...
if exist data_temp_backup\ (
    move data_temp_backup data >nul 2>&1
    echo   - data/ restaurada
)
if exist portfolios_temp_backup\ (
    move portfolios_temp_backup portfolios >nul 2>&1
    echo   - portfolios/ restaurada
)

echo.
echo ========================================
echo  Compilacion completada!
echo ========================================
echo.
echo Los ejecutables estan en la carpeta dist/
echo   - Windows: dist\EduPortfolio Setup 0.3.0.exe (instalador)
echo   - Windows: dist\EduPortfolio 0.3.0.exe (portable)
echo   - Linux:   dist\eduportfolio-web-0.3.0.tar.gz
echo   - Linux:   dist\eduportfolio-web-0.3.0.zip
echo.
pause
