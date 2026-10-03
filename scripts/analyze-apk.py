"""Extract reproducible, public APK evidence. No device account data is read."""
import base64, hashlib, json, pathlib, re, struct, sys, zipfile

apk = pathlib.Path(sys.argv[1])
out = pathlib.Path('.local/apk-evidence')
out.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(apk) as archive:
    dex = archive.read('classes.dex')
    count, offset = struct.unpack_from('<II', dex, 0x38)
    strings = []
    for index in range(count):
        pos = struct.unpack_from('<I', dex, offset + index * 4)[0]
        while dex[pos] & 0x80:
            pos += 1
        pos += 1
        end = dex.index(b'\0', pos)
        strings.append(dex[pos:end].decode('utf-8', errors='replace'))
    classes = [s for s in strings if s.startswith('Lcom/coolapk/') and s.endswith(';')]
    urls = sorted(set(s for s in strings if s.startswith(('http://', 'https://')) and 'coolapk' in s))
    paths = sorted(set(s for s in strings if re.fullmatch(r'/?(?:v[0-9]+/)?(?:feed|user|main|search|apk|topic|message|notification|account|collection|page)/[A-Za-z0-9_/?=&.%-]+', s)))
    (out/'classes.txt').write_text('\n'.join(classes), encoding='utf-8')
    (out/'strings.txt').write_text('\n'.join(strings), encoding='utf-8')
    lib = archive.read('lib/arm64-v8a/libauth.so')
    (out/'libauth.so').write_bytes(lib)
    printable = re.findall(rb'[\x20-\x7e]{8,}', lib)
    (out/'libauth-strings.txt').write_text('\n'.join(s.decode('ascii') for s in printable), encoding='utf-8')
    candidates = re.findall(rb'[a-zA-Z0-9+/=]{1200,1300}', lib)
    auth_table = None
    for candidate in candidates:
        try:
            decoded = bytes(v ^ 0x5a for v in base64.b64decode(candidate, validate=True))
            if len(decoded) == 930 and re.fullmatch(rb'[a-zA-Z0-9+/=]+', decoded):
                for index in range(100):
                    base64.b64decode(decoded[index*4+128:index*4+256], validate=True)
                auth_table = decoded
                break
        except ValueError:
            continue
    if auth_table is None:
        raise RuntimeError('Expected libauth table not found; do not substitute unverified data')
    (out/'auth-table.bin').write_bytes(auth_table)
    evidence = {'apk':apk.name, 'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(), 'dex_string_count':count, 'coolapk_class_count':len(classes), 'urls':urls, 'api_paths':paths, 'libauth_sha256':hashlib.sha256(lib).hexdigest(), 'auth_table_sha256':hashlib.sha256(auth_table).hexdigest(), 'auth_table_size':len(auth_table), 'auth_table_xor_key':'0x5a', 'packer':'com.netease.nis.wrapper', 'java_core_decompiled':False}
    pathlib.Path('research/apk-evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in evidence.items() if k not in ('urls','api_paths')}, ensure_ascii=False))
