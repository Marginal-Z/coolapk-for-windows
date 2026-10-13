const { execFile } = require('node:child_process');

const POWERSHELL = [
  "$routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)",
  "if ($routes.Count -eq 0) { 'unknown'; exit 0 }",
  '$route = $routes | Sort-Object RouteMetric | Select-Object -First 1',
  '$adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue',
  "if (-not $adapter -or $adapter.Status -ne 'Up') { 'unknown' }",
  "elseif ($adapter.NdisPhysicalMedium -eq 9 -or ([string]$adapter.NdisPhysicalMedium -match '(?i)802\\.11|wireless|wi-?fi')) { 'wifi' }",
  "else { 'other' }",
].join('; ');

function parseNetworkType(value) {
  const lines = String(value ?? '').trim().split(/\r?\n/).map(line => line.trim().toLowerCase());
  const last = lines.at(-1);
  return ['wifi', 'other', 'unknown'].includes(last) ? last : 'unknown';
}

function createNetworkTypeReader({ platform = process.platform, execFileImpl = execFile, now = Date.now, cacheMs = 10000 } = {}) {
  let cachedAt = -Infinity, cached = 'unknown', pending = null;
  return () => {
    if (platform !== 'win32') return Promise.resolve('unknown');
    if (now() - cachedAt < cacheMs) return Promise.resolve(cached);
    if (pending) return pending;
    pending = new Promise(resolve => {
      const finish = (error, stdout) => {
        cached = error ? 'unknown' : parseNetworkType(stdout);
        cachedAt = now(); pending = null; resolve(cached);
      };
      try {
        execFileImpl('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', POWERSHELL], { windowsHide: true, timeout: 5000, maxBuffer: 1024, encoding: 'utf8' }, finish);
      } catch (error) { finish(error, ''); }
    });
    return pending;
  };
}

module.exports = { createNetworkTypeReader, parseNetworkType };
