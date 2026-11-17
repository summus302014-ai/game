@echo off
chcp 65001 >nul
title HEXWORLD
cd /d "%~dp0"

echo ==================================================
echo   HEXWORLD - запуск
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node
node -e "process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)" >nul 2>nul
if errorlevel 1 goto old_node
if not exist "server.js" goto no_server
if not exist "hexworld.html" goto no_html

rem --- Зависимости (сейчас проект их не требует; проверка нужна на будущее)
if not exist "package.json" goto env_check
findstr /C:"\"dependencies\"" "package.json" >nul 2>nul
if errorlevel 1 goto env_check
if exist "node_modules" goto env_check
echo Устанавливаю зависимости, подождите...
call npm install
if errorlevel 1 goto npm_fail

:env_check
if exist ".env" goto env_exists
if not exist ".env.example" goto no_example
copy ".env.example" ".env" >nul
echo Файл .env создан из .env.example.
goto env_edit

:env_exists
findstr /R /B /C:"LLM_API_KEY=." ".env" >nul 2>nul
if not errorlevel 1 goto run

:env_edit
echo.
echo Нужно вписать API-ключ. Сейчас откроется Блокнот с файлом .env:
echo   1. Найдите строку LLM_API_KEY= и вставьте ключ сразу после знака равно.
echo   2. Сохраните файл (Ctrl+S) и закройте Блокнот.
echo.
start "" /wait notepad ".env"
findstr /R /B /C:"LLM_API_KEY=." ".env" >nul 2>nul
if errorlevel 1 goto no_key

:run
echo.
echo Запускаю сервер. Не закрывайте это окно, пока играете.
echo Игра откроется в браузере сама. Если нет - откройте http://localhost:3000
echo Остановить сервер: закройте это окно или нажмите Ctrl+C.
echo.
node server.js
echo.
echo Сервер остановлен.
goto end

:no_node
echo ОШИБКА: Node.js не найден.
echo Скачайте версию LTS на https://nodejs.org , установите с настройками по умолчанию,
echo затем снова дважды кликните start.bat.
goto end

:old_node
echo ОШИБКА: версия Node.js слишком старая, нужна 18 или новее.
echo Установите свежую версию LTS с https://nodejs.org и запустите start.bat снова.
goto end

:no_server
echo ОШИБКА: рядом с start.bat нет файла server.js. Положите все файлы проекта в одну папку.
goto end

:no_html
echo ОШИБКА: рядом с start.bat нет файла hexworld.html. Положите все файлы проекта в одну папку.
goto end

:no_example
echo ОШИБКА: нет файла .env.example. Создайте вручную файл .env со строкой LLM_API_KEY=ваш_ключ
goto end

:no_key
echo.
echo ОШИБКА: в файле .env не указан LLM_API_KEY. Впишите ключ после знака равно,
echo сохраните файл и запустите start.bat снова.
goto end

:npm_fail
echo ОШИБКА: не удалось установить зависимости. Проверьте интернет и запустите start.bat снова.
goto end

:end
echo.
pause
