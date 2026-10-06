import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRelease, fetchLatestRelease } from './dist/release.js';
const base='https://github.com/Z-YO-YI/coolapk-for-windows/releases/';
function fixture(version='12.3.4') {
  return {tag_name:`v${version}`,draft:false,prerelease:false,html_url:base+`tag/v${version}`,assets:[`Coolapk-Desktop-Setup-${version}-x64.exe`,`Coolapk-Desktop-${version}-x64.exe`].map(name=>({name,state:'uploaded',size:111645050,browser_download_url:base+`download/v${version}/${name}`}))};
}
test('future stable release selects installer and portable from its own tag',()=>{
  const release=resolveRelease(fixture());assert.equal(release.version,'12.3.4');assert.match(release.assets.installer.url,/v12\.3\.4\/Coolapk-Desktop-Setup-12\.3\.4-x64\.exe$/);
  assert.match(release.assets.portable.url,/Coolapk-Desktop-12\.3\.4-x64\.exe$/);
});
test('draft, prerelease, missing installer and ambiguous assets are rejected',()=>{
  for(const field of ['draft','prerelease']){const data=fixture();data[field]=true;assert.throws(()=>resolveRelease(data));}
  const empty=fixture();empty.assets=[];assert.throws(()=>resolveRelease(empty));
  const duplicate=fixture();duplicate.assets.push({...duplicate.assets[0]});assert.throws(()=>resolveRelease(duplicate));
});
test('download origin, repository, version and credentials must match',()=>{
  for(const url of ['https://example.com/installer.exe',base+'download/v0.1.0/Coolapk-Desktop-Setup-12.3.4-x64.exe','https://github.com@evil.example/installer.exe',base+'download/v12.3.4/Coolapk-Desktop-Setup-12.3.4-x64.exe?redirect=other']){const data=fixture();data.assets[0].browser_download_url=url;assert.throws(()=>resolveRelease(data));}
});
test('optional portable absence retains valid installer release',()=>{const data=fixture();data.assets.pop();assert.ok(resolveRelease(data).assets.installer);assert.equal(resolveRelease(data).assets.portable,undefined);});
test('HTTP failures propagate for latest-page fallback; requests omit credentials',async()=>{
  await assert.rejects(fetchLatestRelease(async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');return {ok:false,status:429};}));
  const release=await fetchLatestRelease(async()=>({ok:true,json:async()=>fixture('13.0.0')}));assert.equal(release.version,'13.0.0');
});
