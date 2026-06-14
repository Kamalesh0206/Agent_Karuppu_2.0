@echo off
title Agent Karuppu Launcher
:: Auto-sync visual testing comment
echo ==========================================================
echo       Agent Karuppu Instagram Publisher Local Setup
echo ==========================================================
echo.

:: 1. Copy env file if not exists
if not exist .env (
    echo [System] Copying .env.example to .env...
    copy .env.example .env > nul
)

:: 2. Create Python virtual environment if not exists
if not exist venv (
    echo [System] Creating Python virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo [Error] Failed to create python virtual environment. Make sure Python is added to your PATH.
        pause
        exit /b 1
    )
)

:: 3. Install Python requirements
echo [System] Activating virtual environment and installing packages...
call venv\Scripts\activate
pip install -r backend\requirements.txt
if errorlevel 1 (
    echo [Error] Pip installation failed. Check your network connection and python installation.
    pause
    exit /b 1
)

:: 4. Start Backend Server in a new window
echo [System] Starting FastAPI Backend on port 8000...
start cmd /k "title Agent Karuppu - Backend && call venv\Scripts\activate && cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8000"

:: 5. Install Frontend dependencies
echo [System] Installing frontend node packages (this may take a minute)...
cd frontend
call npm.cmd install
if errorlevel 1 (
    echo [Error] NPM install failed. Make sure Node.js is installed.
    pause
    exit /b 1
)

:: 6. Start Frontend Server in a new window
echo [System] Starting React Dashboard on port 3000...
start cmd /k "title Agent Karuppu - Frontend && npm.cmd run dev"

echo.
echo ==========================================================
echo              LAUNCH COMPLETED SUCCESSFULLY!
echo ==========================================================
echo.
echo  - React Dashboard Link:  http://127.0.0.1:3000
echo  - FastAPI Swagger Docs:  http://127.0.0.1:8000/docs
echo.
echo Launching your browser now...
timeout /t 3 > nul
start http://127.0.0.1:3000

exit /b 0
