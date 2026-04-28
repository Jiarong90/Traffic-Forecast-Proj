const path = require('path');
const { spawn } = require('child_process');
const config = require('../../config');

async function runPythonCompute(op, payload, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.PYTHON_BIN, [config.PY_ENGINE_PATH, '--op', op], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Python compute timeout: ${op}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Python startup failed: ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`Python compute failed(code=${code}): ${stderr.trim() || 'unknown error'}`));
      }
      try {
        const parsed = JSON.parse(stdout || '{}');
        resolve(parsed);
      } catch (parseErr) {
        reject(new Error(`Python output parse failed: ${parseErr.message}`));
      }
    });

    child.stdin.write(JSON.stringify(payload || {}));
    child.stdin.end();
  });
}

async function runPythonJsonScript(scriptPath, payload, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.PYTHON_BIN, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Python script timeout: ${path.basename(scriptPath)}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Python startup failed: ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`Python script failed(code=${code}): ${stderr.trim() || 'unknown error'}`));
      }
      try {
        resolve(JSON.parse(stdout || '{}'));
      } catch (parseErr) {
        reject(new Error(`Python output parse failed: ${parseErr.message}`));
      }
    });

    child.stdin.write(JSON.stringify(payload || {}));
    child.stdin.end();
  });
}

async function canReachFastApi(baseUrl) {
  if (!baseUrl) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timer);
    return resp.ok;
  } catch (_) {
    return false;
  }
}

async function getFastApiBaseUrl() {
  const localUrl = 'http://127.0.0.1:8000';
  if (config.FASTAPI_BASE_URL !== localUrl && await canReachFastApi(config.FASTAPI_BASE_URL)) {
    return config.FASTAPI_BASE_URL;
  }
  if (await canReachFastApi(localUrl)) {
    return localUrl;
  }
  return config.FASTAPI_BASE_URL;
}

async function callFastApiJson(pathname, payload, timeoutMs = 12000) {
  const baseUrl = await getFastApiBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: payload || {} }),
      signal: controller.signal
    });
    let data = {};
    try {
      data = await resp.json();
    } catch (_) { }
    if (!resp.ok) {
      throw new Error(data?.detail || data?.error || `FastAPI error: ${resp.status}`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`FastAPI timeout: ${pathname}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  runPythonCompute,
  runPythonJsonScript,
  canReachFastApi,
  getFastApiBaseUrl,
  callFastApiJson
};
