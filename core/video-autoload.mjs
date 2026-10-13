/**
 * The Android setting is Wi-Fi-specific. Unknown connection types intentionally
 * stay manual so a desktop with no Network Information API cannot spend data.
 */
export function shouldAutoLoadVideoWhenWifi(preferences, network, visible) {
  return preferences?.autoLoadVideoWhenWifi === true
    && network?.type === 'wifi'
    && network?.saveData !== true
    && visible === true;
}
