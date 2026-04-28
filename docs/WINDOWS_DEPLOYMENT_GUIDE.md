# Windows User Deployment Guide

This guide explains how to deploy and run the FAST demo on a Windows computer.

Recommended approach: use WSL Ubuntu. It is closer to the macOS/Linux environment and usually causes fewer Python dependency issues.

## Option 1: WSL Ubuntu Recommended

### 1. Install WSL Ubuntu

Open PowerShell as Administrator:

```powershell
wsl --install
```

Restart the computer if Windows asks you to do so.

Then open Ubuntu from the Start Menu.

### 2. Install Required Tools In Ubuntu

```bash
sudo apt update
sudo apt install -y git nodejs npm python3 python3-venv python3-pip
```

### 3. Clone Or Copy The Project

If using Git:

```bash
cd ~
git clone <your-repository-url>
cd fyp_demo
```

If the project is already copied to Windows, it is still better to place it inside the WSL Linux filesystem, for example:

```bash
~/fyp_demo
```

Avoid running the project directly from `/mnt/c/...` if possible, because file access can be slower.

### 4. Install Node.js Dependencies

```bash
cd ~/fyp_demo/backend
npm install
```

### 5. Prepare Python Virtual Environment

```bash
cd ~/fyp_demo/backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r ../python/requirements-fastapi.txt
```

### 6. Configure Environment Variables

Create or edit:

```bash
~/fyp_demo/backend/.env
```

Example:

```env
PORT=3000
DATABASE_URL=your_database_url
DATABASE_SSL=true

SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

FASTAPI_BASE_URL=http://127.0.0.1:8000
PYTHON_BIN=python3

OPENWEATHER_API_KEY=your_openweather_key
GEMINI_API_KEY=your_gemini_key
```

### 7. Start The Demo

From the project root:

```bash
cd ~/fyp_demo
./start.sh
```

Then open:

```text
http://localhost:3000/
```

## Option 2: Native Windows PowerShell

Use this method if you do not want to use WSL.

### 1. Install Required Software

Install:

- Node.js 18 or newer
- Python 3.11
- Git
- Chrome or Edge

Database:

- Use Supabase PostgreSQL, or
- Install PostgreSQL locally on Windows

### 2. Open The Project

```powershell
cd C:\path\to\fyp_demo
```

### 3. Install Node.js Dependencies

```powershell
cd backend
npm install
```

### 4. Create Python Virtual Environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r ..\python\requirements-fastapi.txt
```

If PowerShell blocks virtual environment activation, run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then activate again:

```powershell
.\.venv\Scripts\Activate.ps1
```

### 5. Configure Environment Variables

Create or edit:

```text
backend\.env
```

Example:

```env
PORT=3000
DATABASE_URL=your_database_url
DATABASE_SSL=true

SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

FASTAPI_BASE_URL=http://127.0.0.1:8000
PYTHON_BIN=python

OPENWEATHER_API_KEY=your_openweather_key
GEMINI_API_KEY=your_gemini_key
```

### 6. Start FastAPI

Open one PowerShell window:

```powershell
cd C:\path\to\fyp_demo
.\backend\.venv\Scripts\python.exe -m uvicorn python.api_server:app --host 127.0.0.1 --port 8000
```

### 7. Start Node.js Backend

Open another PowerShell window:

```powershell
cd C:\path\to\fyp_demo\backend
npm start
```

### 8. Open The Web App

```text
http://localhost:3000/
```

## Android Phone Live Location

If the Windows user wants to use an Android phone as the live GPS device:

### 1. Start Node.js

Make sure the web app is running on:

```text
http://localhost:3000/
```

### 2. Start Cloudflared

Install cloudflared first, then run:

```powershell
cloudflared tunnel --url http://localhost:3000
```

Cloudflared will print a temporary HTTPS address such as:

```text
https://example-name.trycloudflare.com
```

### 3. Open Mobile Location Page On Android

On the Android phone, open:

```text
https://example-name.trycloudflare.com/mobile-location.html
```

Allow browser location permission.

The Mac/Windows demo page can continue using:

```text
http://localhost:3000/
```

## Notes

- `start.sh` is designed for macOS/Linux/WSL.
- Native Windows PowerShell users should start FastAPI and Node.js in two terminals.
- If needed, a separate `start.ps1` can be created for one-click Windows startup.
- The browser location API requires a secure origin. `localhost` is allowed, but phone access through a LAN IP is usually blocked unless HTTPS is used. Cloudflared solves this by providing an HTTPS URL.

## Common Problems

### Python command not found

Use:

```powershell
py -3.11 --version
```

If this works, create the virtual environment with:

```powershell
py -3.11 -m venv .venv
```

### PowerShell cannot activate venv

Run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Port 3000 or 8000 already in use

Close the old terminal, or find and stop the process using that port.

### NumPy architecture or binary error

This usually means Python packages were installed for the wrong environment.

Safest fix:

```powershell
cd C:\path\to\fyp_demo\backend
Remove-Item -Recurse -Force .venv
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r ..\python\requirements-fastapi.txt
```

### FastAPI starts but Node route planning fails

Check that FastAPI is running:

```text
http://127.0.0.1:8000/health
```

It should return:

```json
{"ok": true}
```

