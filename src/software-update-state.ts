import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateState } from './SoftwareUpdate';
import { unwrap } from './data';
import packageInfo from '../package.json';

export function useSoftwareUpdates() {
  const [state, setState] = useState<UpdateState>({ currentVersion: packageInfo.version, status: 'unsupported', distribution: 'development' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false), locked = useRef(false), revision = useRef(0);
  useEffect(() => {
    let disposed = false;
    active.current = true;
    const bridge = window.coolapk;
    if (!bridge?.updates || !bridge.onUpdates) return () => { active.current = false; };
    const stop = bridge.onUpdates(snapshot => { revision.current++; if (active.current) { setState(snapshot); setError(''); } });
    const start = revision.current;
    void unwrap(bridge.updates('info')).then(snapshot => { if (!disposed && active.current && start === revision.current) setState(snapshot); }).catch(failure => { if (!disposed && active.current) setError(failure.message); });
    return () => { disposed = true; active.current = false; stop(); };
  }, []);
  const action = useCallback(async (operation: 'check' | 'download' | 'cancel' | 'install') => {
    if (locked.current || !window.coolapk?.updates) return;
    locked.current = true; setBusy(true); setError('');
    const start = revision.current;
    try {
      const snapshot = await unwrap(window.coolapk.updates(operation));
      if (active.current && start === revision.current) setState(snapshot);
    } catch (failure) { if (active.current) setError((failure as Error).message); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }, []);
  return { state, busy, error, action };
}
