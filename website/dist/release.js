export const LATEST_PAGE = 'https://github.com/Z-YO-YI/coolapk-for-windows/releases/latest';
export const RELEASE_API = 'https://api.github.com/repos/Z-YO-YI/coolapk-for-windows/releases/latest';
const repositoryPath = '/Z-YO-YI/coolapk-for-windows/releases/';

function trustedUrl(raw, path) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === path ? url.href : null;
  } catch { return null; }
}

// Version and filenames come from the same release, never from a pinned site version.
export function resolveRelease(data) {
  if (!data || data.draft !== false || data.prerelease !== false || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(data.tag_name)) throw new Error('Invalid stable release');
  const version = data.tag_name.slice(1);
  const releaseUrl = trustedUrl(data.html_url, repositoryPath + 'tag/' + data.tag_name);
  if (!releaseUrl || !Array.isArray(data.assets)) throw new Error('Invalid release source');
  const assets = {};
  for (const [kind, name] of Object.entries({ installer: `Coolapk-Desktop-Setup-${version}-x64.exe`, portable: `Coolapk-Desktop-${version}-x64.exe` })) {
    const matches = data.assets.filter(asset => asset.name === name);
    if (matches.length !== 1) continue;
    const asset = matches[0];
    const url = trustedUrl(asset.browser_download_url, repositoryPath + `download/${data.tag_name}/${name}`);
    if (url && asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 0) assets[kind] = { url, size: asset.size };
  }
  if (!assets.installer) throw new Error('Installer not available');
  return { version, releaseUrl, assets };
}

export async function fetchLatestRelease(fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(RELEASE_API, { signal: controller.signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error('Release request failed');
    return resolveRelease(await response.json());
  } finally { clearTimeout(timer); }
}
