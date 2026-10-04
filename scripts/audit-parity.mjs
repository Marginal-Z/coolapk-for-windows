import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogContracts, catalogOperations } from '../core/catalog.mjs';
import { GOODS_CONTRACTS, GOODS_OPERATIONS } from '../core/goods.mjs';
import { HOME_OPERATIONS } from '../core/home.mjs';
import { SEARCH_OPERATIONS } from '../core/search.mjs';
import { ACCOUNT_OPERATIONS } from '../core/account.mjs';
import { DOWNLOAD_OPERATIONS } from '../core/download.mjs';
import { SECONDHAND_OPERATIONS } from '../core/secondhand.mjs';
import { APP_DISCOVERY_OPERATIONS } from '../core/app-discovery.mjs';
import { USER_DISCOVERY_OPERATIONS } from '../core/user-discovery.mjs';
import { CREATION_OPERATIONS } from '../core/creation.mjs';
import { PERSONAL_OPERATIONS } from '../core/personal.mjs';
import { SECONDHAND_PUBLISHING_OPERATIONS } from '../core/secondhand-publishing.mjs';
import { ACCOUNT_SETTINGS_OPERATIONS } from '../core/account-settings.mjs';
import { REPLY_VISIBILITY_OPERATIONS } from '../core/reply-visibility.mjs';

// Static source audit only: never instantiate an authenticated client or send requests.
const referencePath = '.local/reference/coolapk-desktop-main/src-tauri/src/coolapk/client.rs';
if (!existsSync(referencePath)) throw new Error('Place the MIT reference checkout at .local/reference/coolapk-desktop-main before regenerating this source audit.');
const source = readFileSync(referencePath, 'utf8');
const checkedAt = new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('hex');
const read = path => readFileSync(path, 'utf8');
const files = directories => directories.flatMap(directory => readdirSync(directory).filter(name => /\.(?:mjs|cjs|tsx|ts)$/.test(name)).map(name => ({ path: `${directory}/${name}`, source: read(`${directory}/${name}`) })));
const backend = files(['core', 'electron']), frontend = files(['src']);
const json = path => existsSync(path) ? JSON.parse(read(path)) : null;
const appUserLiveChecks = (json('research/app-user-discovery-live-checks.json')?.results || []).filter(item => item.operation !== 'home.public-prerequisite').map(item => ({ ...item, operation: item.operation.split('.')[0], observedVariant: item.operation, evidence: 'research/app-user-discovery-live-checks.json' }));
const hotTopicLiveChecks = (json('research/hot-topics-live-checks.json')?.results || []).map(item => ({ ...item, evidence: 'research/hot-topics-live-checks.json' }));
const liveChecks = [...(json('research/catalog-live-checks.json')?.results || []), ...(json('research/discovery-live-checks.json')?.results || []), ...(json('research/secondhand-live-checks.json')?.results || []).map(item => ({ ...item, state: item.status })), ...appUserLiveChecks, ...hotTopicLiveChecks];
const uiChecks = json('research/catalog-ui-checks.json')?.checks || [];
const goodsChecks = json('research/goods-ui-checks.json')?.checks || [];
const accountSettingsEvidence = json('research/account-settings-contracts.json');
const teenagerNativeChecks = json('research/teenager-native-checks.json')?.checks || [];
const desktopEffectsChecks = json('research/desktop-effects-ui-checks.json')?.checks || [];
const secondhandPublishingEvidence = ['research/secondhand-publishing-contracts.json', 'scripts/test-secondhand-publishing.mjs', 'research/secondhand-publishing-ui-checks.json'].filter(existsSync);
const workflowValidation = {
  desktop_shell_layout_and_refresh: { validation: 'Actual built Electron App/preload: centered search, pinned home heading/channels, first-page/top refresh, responsive desktop widths and wide settings. API responses are isolated fixtures.', limitations: ['This checks named desktop layouts and scroll behavior, not every server-defined mobile screen.'] },
  local_background_customization: { validation: 'Local PNG/JPEG/WebP decode/storage/protocol and actual renderer opacity checks with isolated picker results; preference, stale-account and error handling regressions.', limitations: ['Background picker test images are synthetic local files; desktop customization does not establish mobile settings parity.'] },
  app_icon_and_screenshot_media: { validation: 'Strict public image transport and screenshot parsing unit checks; named public app/game icons and QQ/Coolapk screenshots decoded in production Electron CSP/protocol.', limitations: ['Public media availability was observed for named samples only; other service-provided URLs can still fail and retain retry/fallback.'] },
  guest_comments_and_manual_verification: { status: 'partial', validation: 'Guest verification retry, APK validate Cookie, scoped device/identity and original-read lifecycle are covered with isolated main/renderer responses. The official SDK component and challenge images load in production verification CSP after the 0.6.2 repair. A human completed one official guest comment challenge in the production main/preload/renderer and 31 comments displayed; the user confirmed the result.', limitations: ['Only one real guest comment read is accepted after human completion; authenticated comments, alternate pages and full detail verification are not exercised.', 'Official human verification remains required when challenged.'] },
  secondhand_publishing_and_management: { status: 'partial', validation: `${SECONDHAND_PUBLISHING_OPERATIONS.length} recovered fixed operations and native editor; source and isolated tests only. Inspect the current publishing report for completed scenarios; authenticated acceptance remains pending.`, limitations: ['Unsupported video/article edits and unconfirmed returned config/identity variants fail explicitly', 'Real publish/edit/close, agreement acceptance and transaction/order/payment workflows are not validated'] },
  account_privacy_and_notification_settings: { validation: 'Recovered GET account/loadConfig and POST account/updateConfig system_config contracts; 10 privacy and 10 notification fields with per-field synthetic read/write/readback and native renderer evidence.', fieldCount: (accountSettingsEvidence?.privacy?.fields?.length || 0) + (accountSettingsEvidence?.notifications?.fields?.length || 0), limitations: ['No authenticated settings save or cross-device propagation verified', 'Cloud subscription controls do not establish Windows background push delivery'] },
  teenager_curated_mode_and_main_access: { validation: 'Actual built main/preload/App with isolated responses, main clock, Windows safeStorage and process restart; external requests blocked.', localNativeCheckCount: teenagerNativeChecks.length, localNativeEvidence: 'research/teenager-native-checks.json', limitations: ['Official curated endpoint availability and full mobile curated-card parity remain unverified', 'No live phone mode was enabled and no authenticated cloud write was performed'] },
  desktop_material_return_to_top_and_fps: { validation: 'Actual renderer pixels across 54 wallpaper/theme/material states in separate software and normal GPU configurations, protected text contrast, frame sampling, modal/page scroll and keyboard focus; isolated local checks.', rendererCheckCount: desktopEffectsChecks.length, limitations: ['Windows web-renderer effects do not establish identical Android material pixels', 'Remaining laboratory autoplay, push logging and native phone-app inventory consumers are not implemented'] },
  desktop_about_and_restrained_motion: { validation: 'Actual Settings About reads the native app version; synthetic renderer checks cover project links, third-party statement, keyboard focus, reduced motion and safe text parse reuse.', limitations: ['Timing samples are machine/load dependent and are not a production FPS guarantee', 'The third-party statement does not establish full mobile functional parity'] },
  home_surface_and_topic_categories: { status: 'partial', validation: 'Read-only official 16.6.4 phone inventory of all 17 home channels, named guest GETs and separate actual desktop main/preload fixtures. Preserves raw nested cards, all fixed shortcuts/interests and 24 topic categories with desktop layout.', limitations: ['Authenticated follow tabs, cloud tab persistence and writes remain unverified', 'Unavailable legacy lists, username routes and Android commerce callbacks remain explicit gaps', 'Generic preservation of a server card does not prove every child workflow is complete'] },
  author_reply_visibility: { status: 'partial', validation: 'Recovered author-only hideReply/resumeHideReply POST Query id callers and FeedReply Gson fields; fresh original-reply/feed permission checks, server-state readback, account-scope guards and isolated Detail UI checks.', limitations: ['No real authenticated hide/resume or daily-quota acceptance verified', 'Missing server identity/quota fields deny the action; admin recommendation controls and independent comment editing remain separate gaps'] },
  notification_v18_aggregate_badges: { validation: 'Recovered NotifyCount/AppNotification caller and exact notification_v18/feedlike/message formula; module mock and native App source integration only.', limitations: ['Aggregate-only responses cannot prove exact like subtraction', 'This badge calculation is distinct from system background push delivery'] },
};
const workflowEvidence = [
  ['desktop_shell_layout_and_refresh', [], ['src/App.tsx', 'src/desktop-layout.css', 'src/components.tsx'], ['scripts/test-desktop-layout.mjs', 'research/desktop-layout-checks.json']],
  ['local_background_customization', [], ['core/preferences.mjs', 'electron/background-image.cjs', 'electron/main.cjs', 'electron/preload.cjs', 'src/Settings.tsx', 'src/desktop-settings.css', 'src/App.tsx'], ['tests/background-image.test.mjs', 'tests/preferences.test.mjs', 'scripts/test-desktop-settings.mjs', 'scripts/test-desktop-layout.mjs', 'research/desktop-settings-checks.json', 'research/desktop-layout-checks.json']],
  ['app_icon_and_screenshot_media', [], ['core/app-media.mjs', 'core/images.mjs', 'src/Catalog.tsx', 'src/AppDiscovery.tsx', 'src/components.tsx'], ['tests/app-media.test.mjs', 'scripts/test-app-media.mjs', 'research/app-media-live-checks.json', 'research/app-media-native-checks.json', 'research/app-media-ui-checks.json']],
  ['guest_comments_and_manual_verification', [], ['core/client.mjs', 'core/user-discovery.mjs', 'electron/main.cjs', 'electron/request-scope.cjs', 'electron/verify.js', 'electron/verify.html', 'src/Detail.tsx', 'src/components.tsx'], ['tests/guest-verification.test.mjs', 'tests/verification-cookie.test.mjs', 'tests/verification-scope.test.mjs', 'scripts/test-guest-comments.mjs', 'scripts/test-verification-renderer.mjs', 'research/guest-comment-checks.json', 'research/guest-comment-read-probe.json', 'research/captcha-cookie-contract.md', 'research/verification-renderer-checks.json', 'research/verification-renderer-live-checks.json', 'research/guest-verification-live-check.json']],
  ['question_and_poll_creation', CREATION_OPERATIONS, ['core/creation.mjs', 'core/creation-models.mjs', 'src/Creation.tsx', 'src/App.tsx'], ['tests/creation.test.mjs', 'scripts/test-creation.mjs', 'research/creation-contracts.json', 'research/creation-checks.json', 'research/parity-integration-checks.json']],
  ['personal_digital_lists_backups_and_home_blocks', PERSONAL_OPERATIONS, ['core/personal.mjs', 'core/personal-models.mjs', 'src/Personal.tsx', 'src/App.tsx'], ['tests/personal.test.mjs', 'scripts/test-personal.mjs', 'research/personal-native.md', 'research/parity-integration-checks.json']],
  ['editable_local_my_shortcuts', [], ['core/shortcuts.mjs', 'src/ShortcutEditor.tsx', 'src/AccountCenter.tsx'], ['tests/shortcuts.test.mjs', 'scripts/test-account-overview.mjs', 'research/account-overview-checks.json']],
  ['phone_my_overview_and_direct_entries', ['accountOverview', 'accountCards', 'accountTabData'], ['core/account.mjs', 'core/account-overview-models.mjs', 'src/AccountCenter.tsx', 'src/App.tsx'], ['tests/account-overview.test.mjs', 'scripts/test-account-overview.mjs', 'research/account-overview-checks.json', 'research/mobile-ui-baseline.json']],
  ['display_preferences_and_native_cache', [], ['core/preferences.mjs', 'core/public-image-cache.mjs', 'electron/desktop-settings.cjs', 'src/preferences.ts', 'src/Settings.tsx', 'src/App.tsx'], ['tests/preferences.test.mjs', 'tests/desktop-settings.test.mjs', 'scripts/test-settings.mjs', 'scripts/test-settings-native.mjs', 'research/settings-native-checks.json']],
  ['account_privacy_and_notification_settings', ACCOUNT_SETTINGS_OPERATIONS, ['core/account-settings.mjs', 'core/account-settings-models.mjs', 'src/AccountSettings.tsx', 'src/App.tsx'], ['tests/account-settings.test.mjs', 'scripts/test-account-settings.mjs', 'research/account-settings-contracts.json', 'research/account-settings-ui-checks.json']],
  ['teenager_curated_mode_and_main_access', [], ['core/teenager.mjs', 'electron/teenager-access.cjs', 'electron/main.cjs', 'src/Teenager.tsx', 'src/main.tsx', 'src/App.tsx'], ['tests/teenager.test.mjs', 'tests/teenager-access.test.mjs', 'scripts/test-teenager.mjs', 'scripts/test-teenager-native.mjs', 'research/teenager-ui-checks.json', 'research/teenager-native-checks.json', 'research/settings-lab-youth-contracts.json']],
  ['desktop_material_return_to_top_and_fps', [], ['src/DesktopEffects.tsx', 'src/desktop-effects.css', 'core/material-readability.mjs', 'src/Settings.tsx', 'src/App.tsx'], ['tests/material-readability.test.mjs', 'scripts/test-global-materials.mjs', 'research/global-materials-checks.json', 'scripts/test-desktop-effects.mjs', 'research/desktop-effects-ui-checks.json', 'research/settings-lab-youth-contracts.json']],
  ['desktop_about_and_restrained_motion', [], ['src/About.tsx', 'src/Settings.tsx', 'src/desktop-motion.css', 'src/components.tsx'], ['scripts/test-about.mjs', 'scripts/test-desktop-motion.mjs', 'research/desktop-motion-checks.json', 'research/home-native-checks.json']],
  ['home_surface_and_topic_categories', HOME_OPERATIONS, ['core/home-surface.mjs', 'core/home-navigation.mjs', 'src/HomeContent.tsx', 'src/TopicDiscovery.tsx', 'src/App.tsx'], ['research/home-mobile-audit.json', 'research/home-navigation-audit.json', 'research/home-navigation-live-checks.json', 'research/home-native-checks.json', 'tests/home-surface.test.mjs', 'tests/home-navigation.test.mjs', 'scripts/test-home-content.mjs', 'scripts/test-topic-discovery.mjs', 'scripts/test-home-native.mjs']],
  ['author_reply_visibility', REPLY_VISIBILITY_OPERATIONS, ['core/reply-visibility.mjs', 'core/reply-visibility-models.mjs', 'src/ReplyVisibilityButton.tsx', 'src/Detail.tsx'], ['research/reply-visibility-contracts.json', 'tests/reply-visibility.test.mjs', 'scripts/test-reply-visibility.mjs', 'research/reply-visibility-ui-checks.json']],
  ['notification_v18_aggregate_badges', ['notificationCount'], ['core/notifications.mjs', 'src/App.tsx', 'src/Notifications.tsx'], ['tests/notifications.test.mjs', 'research/notification-badge-contracts.json', 'research/notification-checks.json']],
  ['publish_body_mentions_and_topics', ['search', 'accountUsers', 'searchPublishTopics'], ['core/compose-text.mjs', 'src/ComposeTools.tsx', 'src/Composer.tsx'], ['tests/compose-text.test.mjs', 'scripts/test-compose-tools.mjs', 'research/compose-tools-checks.json', 'research/mobile-ui-baseline.json']],
  ['topic_scoped_search', ['topicSearch'], ['core/community.mjs', 'src/TopicSearch.tsx', 'src/Community.tsx'], ['tests/topic-search.test.mjs', 'scripts/test-topic-search.mjs', 'research/topic-search-checks.json']],
  ['vote_dedicated_discussion', ['voteComments'], ['core/catalog.mjs', 'src/VoteComments.tsx', 'src/Community.tsx'], ['tests/catalog.test.mjs', 'scripts/test-vote-comments.mjs', 'research/vote-comment-checks.json']],
  ['notification_center_and_exact_targets', ['notifications', 'notificationCount', 'clearNotificationCount'], ['core/notifications.mjs', 'src/Notifications.tsx', 'src/App.tsx'], ['tests/notifications.test.mjs', 'scripts/test-notifications.mjs', 'research/notification-checks.json']],
  ['account_relationship_management', ['accountUsers', 'accountRelationship'], ['core/account.mjs', 'src/AccountCenter.tsx'], ['scripts/test-account-relations.mjs', 'research/account-relations-checks.json']],
  ['product_rating_sort_and_media', ['catalogProductFeeds', 'catalogProductRatingPage', 'catalogProductMedia', 'catalogProductRatingChart'], ['core/catalog.mjs', 'src/Catalog.tsx'], ['tests/catalog.test.mjs', 'scripts/test-catalog.mjs', 'research/product-workflow-checks.json']],
  ['account_profile_drafts', ['accountProfile', 'accountProfileUpdate'], ['core/account.mjs', 'src/AccountCenter.tsx'], ['scripts/test-navigation.mjs', 'research/navigation-ui-checks.json']],
  ['feed_video_resolution', ['video'], ['core/client.mjs', 'src/components.tsx'], ['scripts/test-media.mjs', 'research/media-checks.json']],
  ['verification_retry_isolation', [], ['src/data.ts', 'src/components.tsx'], ['scripts/test-resource-retry.mjs', 'research/resource-retry-checks.json']],
  ['app_album_cover_upload', ['uploadImage', 'catalogAlbumCreate', 'catalogAlbumEdit'], ['core/upload.mjs', 'src/Catalog.tsx'], ['tests/album-cover.test.mjs', 'research/catalog-ui-checks.json']],
  ['hot_topic_sidebar', ['homeHotTopics'], ['core/home.mjs', 'src/HotTopics.tsx', 'src/App.tsx'], ['tests/hot-topics.test.mjs', 'research/hot-topics-checks.json']],
  ['app_game_discovery', APP_DISCOVERY_OPERATIONS, ['core/app-discovery.mjs', 'src/AppDiscovery.tsx'], ['tests/app-discovery.test.mjs', 'research/app-discovery-checks.json']],
  ['user_profiles_ratings_and_app_nodes', USER_DISCOVERY_OPERATIONS, ['core/user-discovery.mjs', 'src/UserDiscovery.tsx', 'src/Catalog.tsx'], ['tests/user-discovery.test.mjs', 'research/user-discovery-checks.json', 'research/user-discovery-capabilities.json']],
  ['secondhand_browsing', SECONDHAND_OPERATIONS, ['core/secondhand.mjs', 'core/secondhand-routes.mjs', 'src/Secondhand.tsx'], ['tests/secondhand.test.mjs', 'research/secondhand-ui-checks.json', 'research/secondhand-capabilities.json']],
  ['secondhand_publishing_and_management', SECONDHAND_PUBLISHING_OPERATIONS, ['core/secondhand-publishing.mjs', 'core/secondhand-publishing-models.mjs', 'src/SecondhandEditor.tsx', 'src/Secondhand.tsx', 'src/App.tsx'], ['tests/secondhand-publishing.test.mjs', 'research/apk-request-bindings.json', ...secondhandPublishingEvidence]],
  ['goods_and_product_albums', GOODS_OPERATIONS, ['core/goods.mjs', 'src/Goods.tsx'], ['tests/goods.test.mjs', 'research/goods-ui-checks.json', 'research/goods-capabilities.json']],
  ['home_channels', HOME_OPERATIONS, ['core/home.mjs', 'core/home-surface.mjs', 'core/home-navigation.mjs', 'src/HomeChannels.tsx', 'src/HomeContent.tsx', 'src/TopicDiscovery.tsx'], ['tests/home-channels.test.mjs', 'tests/home-surface.test.mjs', 'tests/home-navigation.test.mjs', 'research/home-mobile-audit.json', 'research/home-navigation-live-checks.json', 'research/home-native-checks.json', 'research/discovery-live-checks.json', 'research/sharing-checks.json']],
  ['search_suggestions_and_publish_topics', SEARCH_OPERATIONS, ['core/search.mjs', 'src/SearchSuggestions.tsx', 'src/PublishOptions.tsx'], ['tests/search.test.mjs', 'scripts/test-search-ui.mjs']],
  ['accounts_and_content_tabs', ACCOUNT_OPERATIONS, ['core/account.mjs', 'src/AccountCenter.tsx'], ['tests/account-readonly.test.mjs', 'research/account-ui-checks.json', 'research/account-capabilities.json']],
  ['user_public_home_tabs_and_qr', ['userQr', 'publicUserQr', 'userFollowNodes', 'publicUserFollowNodes', 'userHomepage', 'publicUserHomepage', 'userTabData', 'publicUserTabData'], ['core/user-discovery.mjs', 'core/user-discovery-models.mjs', 'src/UserDiscovery.tsx', 'src/App.tsx'], ['tests/user-discovery.test.mjs', 'scripts/test-user-discovery.mjs', 'research/user-discovery-checks.json', 'research/navigation-ui-checks.json']],
  ['download_pause_and_resume', [], ['core/download.mjs', 'electron/download-manager.cjs', 'src/Downloads.tsx'], ['tests/download-resume.test.mjs', 'scripts/test-downloads.mjs', 'research/download-checks.json']],
  ['image_rich_feed_share', [], ['src/Sharing.tsx', 'electron/local-files.cjs'], ['tests/local-files.test.mjs', 'scripts/test-sharing.mjs', 'research/sharing-checks.json']],
  ['apk_downloads', DOWNLOAD_OPERATIONS, ['core/download.mjs', 'electron/download-manager.cjs', 'src/Downloads.tsx'], ['tests/download.test.mjs', 'tests/download-manager.test.mjs', 'tests/download-resume.test.mjs', 'research/download-checks.json', 'research/download-capabilities.json']],
].map(([family, operations, implementation, evidence]) => ({ family, operations, operationCount: operations.length, implementation, evidence, status: 'implemented', validation: 'source contracts and named mock checks only; inspect evidence for individual test coverage', authenticatedLive: false, ...workflowValidation[family] }));

// Preserve positions/newlines while masking Rust strings, raw strings and comments.
// This prevents format! braces and JSON examples from truncating method bodies.
function maskRust(value) {
  const output = value.split('');
  const blank = (start, end) => { for (let i = start; i < end; i++) if (output[i] !== '\n' && output[i] !== '\r') output[i] = ' '; };
  let i = 0;
  while (i < value.length) {
    if (value.startsWith('//', i)) { const end = value.indexOf('\n', i); blank(i, end < 0 ? value.length : end); i = end < 0 ? value.length : end; continue; }
    if (value.startsWith('/*', i)) { const start = i; let depth = 1; i += 2; while (i < value.length && depth) { if (value.startsWith('/*', i)) { depth++; i += 2; } else if (value.startsWith('*/', i)) { depth--; i += 2; } else i++; } blank(start, i); continue; }
    const raw = value.slice(i).match(/^(?:br|r)(#+)?"/);
    if (raw) { const start = i, ending = `"${raw[1] || ''}`, end = value.indexOf(ending, i + raw[0].length); i = end < 0 ? value.length : end + ending.length; blank(start, i); continue; }
    if (value[i] === '"') { const start = i++; while (i < value.length) { if (value[i] === '\\') i += 2; else if (value[i++] === '"') break; } blank(start, i); continue; }
    const char = value.slice(i).match(/^'(?:\\(?:u\{[\da-f]+\}|x[\da-f]{2}|.)|[^'\r\n])'/i);
    if (char) { blank(i, i + char[0].length); i += char[0].length; continue; }
    i++;
  }
  return output.join('');
}
const masked = maskRust(source), allMethods = new Map();
const declaration = /\b(?:(pub)\s+)?(?:(async)\s+)?fn\s+([a-zA-Z_][a-zA-Z_0-9]*)\s*(?:<[^;{}]*>)?\s*\(/g;
for (const match of masked.matchAll(declaration)) {
  const start = masked.indexOf('{', match.index + match[0].length);
  if (start < 0) continue;
  let depth = 1, end = start + 1;
  while (end < masked.length && depth) { if (masked[end] === '{') depth++; else if (masked[end] === '}') depth--; end++; }
  const body = source.slice(start, end);
  const strings = [...body.matchAll(/"(?:\\.|[^"\\])*"/g)].map(m => m[0].slice(1, -1));
  const endpoints = [...new Set(strings.flatMap(s => { if (/^\/v\d+\//.test(s)) return [s.split('?')[0]]; if (/^https?:\/\/(?:api|www|m|account)\.coolapk\.com\//.test(s)) { const path = s.replace(/^https?:\/\/api\.coolapk\.com/, ''); return [path.split('?')[0]]; } return []; }))];
  const descriptors = [...new Set(strings.filter(s => /^(?:#?\/(?:page\?|topic\/|feed\/|product\/|goods\/)|V\d+_|(?:V|HOME|DISCOVER)_)/.test(s)))];
  allMethods.set(match[3], { name: match[3], publicAsync: !!match[1] && !!match[2], line: source.slice(0, match.index).split('\n').length, endpoints, descriptors, body, calls: [...body.matchAll(/(?:self\s*\.\s*|Self::)([a-zA-Z_][a-zA-Z_0-9]*)\s*(?:<[^>]*>)?\s*\(/g)].map(m => m[1]) });
}
const publicMethods = [...allMethods.values()].filter(method => method.publicAsync);
if (publicMethods.length !== 251) throw new Error(`Reference changed: expected 251 public async methods, found ${publicMethods.length}; review audit mappings before regeneration.`);
function routes(method, seen = new Set()) {
  if (seen.has(method.name)) return [];
  seen.add(method.name);
  return [...new Set([...method.endpoints, ...method.calls.flatMap(name => allMethods.has(name) ? routes(allMethods.get(name), seen) : [])])];
}

// Explicit source-to-operation mapping. Endpoint text overlap is only a candidate,
// and is not enough to label an unknown workflow as implemented.
const mappings = new Map();
function map(names, operation, scope = 'native') { for (const name of names.split(',')) mappings.set(name.trim(), { operation, scope }); }
map('list_accounts,login_as,save_account,persist_current_account,remove_account', 'account IPC', 'local_account_storage');
map('get_by_full_url,get', 'fixed page dispatcher', 'transport_helper');
map('get_index_v8_feeds,get_index_v8_feeds_paged,get_index_v8_entities_paged', 'home');
map('get_rank_feeds,get_rank_feeds_with_mode,get_cool_picture_rank', 'rank');
map('search_all,search_by_type,search_users,search_apks,search_games,search_feed_topics,search_feeds', 'search');
map('get_hot_searches', 'hotSearch');
map('get_hot_topics', 'homeHotTopics');
map('get_sub_replies,get_sub_replies_paged', 'subReplies');
map('get_feed_replies,get_feed_replies_paged', 'replies');
map('get_image_data_url', 'image IPC', 'transport_helper');
map('get_feed_detail,get_public_feed_detail', 'detail');
map('get_editable_feed', 'editableFeed');
map('update_feed', 'action editFeed / editArticle');
map('resolve_video_url', 'video');
map('get_reply_detail', 'replyDetail');
map('get_hidden_replies', 'advancedReplies');
map('get_user_space', 'user');
map('get_public_user_space', 'publicUserSpace', 'public_read_helper');
map('get_user_profile', 'userProfile');
map('get_public_user_profile', 'publicUserProfile');
map('get_user_rating_list', 'userAppRatings');
map('get_node_feeds', 'nodeAppFeeds / topicFeeds / catalogProductFeeds');
map('get_app_list', 'appDiscovery');
map('get_game_list', 'gameDiscovery');
map('get_my_profile', 'accountProfile');
map('get_user_remark_list,get_black_list,get_ignore_list,get_limit_list,get_follow_user_list,get_fans_user_list', 'accountUsers');
map('update_user_profile', 'accountProfileUpdate');
map('change_avatar', 'accountAvatar');
map('update_user_cover', 'accountCover');
map('get_user_feeds,get_user_like_list,get_favorite_list', 'userFeeds');
map('get_feed_collection_status', 'collectionStatus');
map('update_collection_item', 'action updateCollectionItems');
map('get_collection_list', 'collections');
map('get_collection_item_list', 'collectionFeeds');
map('get_collection_detail', 'collection');
map('create_collection', 'action createCollection');
map('update_collection', 'action updateCollection');
map('delete_collection', 'action deleteCollection');
map('remove_collection_item', 'action removeCollectionItem');
map('clear_collection_invalid_items', 'action clearCollectionInvalid');
map('follow_collection', 'action followCollection');
map('unfollow_collection', 'action unfollowCollection');
map('like_collection', 'action likeCollection');
map('unlike_collection', 'action unlikeCollection');
map('follow_dyh', 'catalogDyhFollow');
map('unfollow_dyh', 'catalogDyhUnfollow');
map('get_live_detail', 'liveDetail');
map('follow_live,unfollow_live', 'liveFollow');
map('get_feed_forward_list', 'feedForwards');
map('get_feed_like_list', 'feedLikes');
map('get_feed_change_history', 'feedChanges');
map('follow_tag,unfollow_tag', 'topicFollow');
map('get_followed_topics', 'followedTopics');
map('get_device_feed_list', 'topicDevices');
map('get_question_answers', 'questionAnswers');
map('follow_question', 'questionFollow');
map('unfollow_question', 'questionUnfollow');
map('invite_question_answer', 'questionInvite');
map('get_vote_comments', 'voteComments');
map('create_user_vote', 'voteSubmit');
map('get_hit_history,get_recent_history', 'accountHistory');
map('get_my_profile_cards,get_load_config', 'accountCards');
map('get_my_card_manager', 'accountCardManager');
map('update_my_card_config', 'accountCardSave');
map('get_home_tab_config', 'accountChannels');
map('update_home_tab_config', 'accountChannelSave');
map('get_user_plugins', 'accountPlugins');
map('save_user_plugins', 'accountPluginSave');
map('claim_user_plugin', 'accountPluginClaim');
map('get_topic_detail,get_topic_detail_v7', 'topicDetail');
map('get_topic_feeds', 'topicEntries');
map('get_topic_tab_data,get_topic_hub_data', 'topicServerTab');
map('get_product_detail_by_name,get_product_detail', 'catalogProduct');
map('get_product_versions', 'catalogProductVersions');
map('get_app_detail', 'catalogApp');
map('get_apk_comments,get_apk_feeds', 'catalogAppComments');
map('get_notification_count', 'notificationCount');
map('clear_notification_count', 'clearNotificationCount');
map('get_notifications', 'notifications');
map('list_messages', 'messages');
map('get_recent_chat_users', 'chatRecent');
map('list_chat_history', 'chat');
map('delete_message_chat', 'chatDelete');
map('send_private_message,send_private_image', 'action sendMessage');
map('read_message', 'chatRead');
map('favorite_feed', 'action favorite');
map('unfavorite_feed', 'action unFavorite');
map('favorite_apk', 'catalogAppFavorite');
map('unfavorite_apk', 'catalogAppUnfavorite');
map('delete_feed', 'action deleteFeed');
map('delete_reply', 'action deleteReply');
map('upload_publish_video', 'uploadVideo');
map('upload_image', 'uploadImage');
map('resolve_live_photo_video', 'livePhotoVideo');
map('upload_image_with_live', 'uploadLivePhoto');
map('add_to_black_list,remove_from_black_list,add_to_ignore_list,remove_from_ignore_list,special_follow_user,cancel_follower,update_user_remark', 'accountRelationship');
map('get_apk_url', 'catalogAppUrl');
map('get_apk_qr', 'catalogAppQr');
map('like_feed', 'action like');
map('unlike_feed', 'action unlike');
map('like_reply', 'action likeReply');
map('unlike_reply', 'action unLikeReply');
map('reply_feed', 'action reply');
map('comment_apk', 'catalogAppComment');
map('follow_user', 'action follow');
map('unfollow_user', 'action unfollow');
map('get_following_feeds', 'followingFeeds');
map('create_feed,create_feed_with_options', 'action publish / publishAdvanced');
map('create_answer', 'questionAnswer');
map('create_forward', 'action forward');
map('check_login_status,check_login_info', 'checkLogin');
map('login_by_account,send_sms_vcode,login_by_mobile,login_by_webview_cookie,login_by_access_code', 'login IPC', 'authentication');
map('get_product_feeds', 'catalogProductFeeds');
map('get_product_subtab_feeds', 'catalogProductSubtab');
map('get_product_config', 'catalogProductConfig');
map('add_config_compare', 'catalogCompareAdd');
map('remove_config_compare', 'catalogCompareRemove');
map('get_product_brand_list', 'catalogProductBrands');
map('get_product_category_list', 'catalogProductCategories');
map('get_product_list', 'catalogProductCategoryItems');
map('get_product_brand_products', 'catalogProductBrandItems');
map('get_product_media_list', 'catalogProductMedia');
map('change_product_wish_status', 'catalogProductWish');
map('change_product_follow_status', 'catalogProductFollow');
map('get_product_wish_list', 'catalogProductWishUsers');
map('get_product_buy_list', 'catalogProductBuyUsers');
map('get_my_product_list', 'catalogMyProducts');
map('get_product_rating_chart', 'catalogProductRatingChart');
map('create_product_rating', 'catalogProductReview');
map('get_product_rating_list', 'catalogProductRatings');
map('get_apk_rating_user_list', 'catalogAppRatings');
map('change_rating_status', 'catalogRating');
map('get_dyh_detail', 'catalogDyh');
map('get_dyh_list', 'catalogDyhs');
map('get_dyh_feeds', 'catalogDyhFeeds');
map('get_event_list', 'catalogEvents');
map('get_event_detail', 'catalogEvent');
map('get_dyh_follow_list', 'catalogDyhFollowing');
map('get_dyh_subscribe_list', 'catalogDyhSubscriptions');
map('get_dyh_editor_list', 'catalogDyhEditing');
map('get_album_list', 'catalogAlbums');
map('search_albums', 'catalogAlbumSearch');
map('get_album_detail', 'catalogAlbum');
map('get_user_album_list', 'catalogMyAlbums');
map('create_album', 'catalogAlbumCreate');
map('edit_album', 'catalogAlbumEdit');
map('add_album_apk', 'catalogAlbumAddApp');
map('delete_album_apk', 'catalogAlbumRemoveApp');
map('get_album_replies', 'catalogAlbumReplies');
map('get_apk_discoverers', 'catalogAppDiscoverers');
map('get_apk_recommend_list', 'catalogAppRecommend');
map('get_apk_related_apps', 'catalogAppRelated');
map('get_apk_gift_list', 'catalogAppGifts');
map('get_download_version_list', 'catalogAppVersions / apkDownloadVersions');
map('get_picture_list', 'catalogPictures');
map('search_apks_by_developer', 'catalogAppDeveloper');
map('search_apks_by_tag', 'catalogAppTag');
map('get_goods_search_hot_words', 'goodsHotWords');
map('search_goods', 'goodsSearch');
map('prepare_goods_by_url', 'goodsPrepare');
map('get_goods_detail', 'goodsDetail');
map('get_goods_list_types', 'goodsListTypes');
map('get_goods_list,get_goods_list_items', 'goodsLists');
map('get_goods_store_items', 'goodsStore');
map('get_product_albums,get_user_product_albums', 'goodsAlbums');
map('get_my_goods_feeds', 'goodsMyFeeds');
map('create_goods_list', 'goodsListCreate');
map('edit_goods_list', 'goodsListEdit');
map('add_goods_to_goods_list', 'goodsItemAdd');
map('delete_goods_list_items', 'goodsItemRemove');
map('edit_goods_list_item', 'goodsItemEdit');
map('vote_goods_list_item', 'goodsItemVote');
map('bind_feed_to_goods_list', 'goodsListBind');
map('create_product_album', 'goodsAlbumCreate');
map('get_headline_feeds', 'homeHeadline');
map('get_update_list', 'homeUpdates');
map('get_editor_choice_feeds', 'homeEditorChoice');
map('update_home_tab_config', 'homeTabConfig / accountChannelSave');
map('get_tab_config,get_discovery_config', 'init');
map('get_discovery_page_data', 'page');
map('get_search_suggestions', 'searchSuggestions');
map('get_search_suggestions_app', 'searchSuggestionsApp');
map('search_publish_topics,search_tags', 'searchPublishTopics');
map('get_user_qr_image', 'accountQr');
map('get_user_follow_nodes,get_user_forum_follow_list', 'accountFollowNodes');
map('get_user_tab_data', 'accountTabData');
map('get_spam_feed_list', 'accountSpamFeeds');
map('verify_apk_download', 'apkDownloadVerify');
map('get_secondhand_brand_list', 'secondhandBrands');
map('get_secondhand_product_list', 'secondhandProducts');
map('get_secondhand_feeds', 'secondhandHome / secondhandListings / secondhandSearch');
map('get_latest_feeds', 'homeNews');
map('get_digest_feeds', 'homeDigest');
map('get_hot_replies', 'hotReplies');
const mappingLimits = {
  get_hot_topics: 'Fixed V9_HOME_TAB_TOPIC page-one request; at most five top-level topic entities with returned heat counts. This does not establish every mobile topic ranking, category, or nested discovery card.',
  get_load_config: 'Pure reference alias of get_my_profile_cards(false): key=my_page_card_config, refresh=0. This mapping adds no separate native feature or authenticated verification.',
  get_apk_feeds: 'Confirmed app commentList request with id/listType and pagination; only lastupdate_desc, dateline_desc and popular sorting are confirmed. Returned lists preserve unknown raw entities rather than reproducing every reference cleanup rule. Complete mobile feed filtering remains unverified.',
  get_app_list: 'Fixed application rank/newest descriptors and four reference keyword categories are implemented. Failed rank requests are not converted into a successful search; reference fallback heuristics and every mobile app category remain unverified.',
  get_game_list: 'Six exact reference category search words are implemented. Keyword results are not a native game ranking or an exhaustive official category inventory.',
  get_user_profile: 'Authenticated profile read and returned-field renderer implemented; all permission-dependent profile variants remain unverified.',
  get_public_user_profile: 'Independent guest client/device without current account Cookie; returned fields only. API-origin failover and complete native descriptor inventory remain unverified.',
  get_public_user_space: 'Independent guest read helper is implemented; relationship-aware user header still uses current account context. Not an additional native screen.',
  get_node_feeds: 'Confirmed app, topic and product branches only. Unknown generic nodeType values and nodeFeedList descriptor variants remain gaps.',
  get_latest_feeds: 'Fixed V11_HOME_TAB_NEWS descriptor is implemented. Reference fallback digestList type=1/newestList is intentionally not claimed; API failure remains visible.',
  get_digest_feeds: 'Community #/feed/digestList is distinct from editorial /feed/editorChoiceList. The named native channel is implemented; authenticated/server filtering parity remains unverified.',
  get_hot_replies: 'Dedicated hotReplyList id/page/discussMode=1 mode, distinct from popular replyList. Author/hidden scopes use their own confirmed list rather than inventing hotReplyList filters.',
  get_goods_list_items: 'This reference helper calls global goodsList/list; it does not establish true per-list items. Desktop list detail strictly reads feed/detail goodsListItem.',
  get_discovery_page_data: 'The fixed internal descriptor dispatcher accepts only implemented official route families. Generic route overlap does not establish support for every native descriptor or parameter.',
  get_user_qr_image: 'Current and target-user QR have fixed raster-image contracts and synthetic native UI checks; official live eligibility remains unverified.',
  get_user_follow_nodes: 'Current and target-user followed-node listing with exact UID and pagination; hidden visibility and node-management permissions are not inferred.',
  get_user_forum_follow_list: 'Current and public target-user followed-node pagination implemented; official visibility remains unverified.',
  get_user_tab_data: 'Fixed own-account content tabs and target-user public tab allowlist implemented; optional tabs follow returned visibility fields. Secondhand create/edit/close use a separate recovered module and remain authenticated-live unverified. Private tabs and recycle restoration remain incomplete.',
  create_product_album: 'Official APK caller corrects the reference default: ordinary album_type=1, ladder=2. Published edits use productAlbum/edit with complete indexed items; detail uses feed/detail productAlbumDetailInfo, and owned ordinary deletion uses feed/deleteFeed id/notNotify=0. No real account submission is established.',
  update_home_tab_config: 'Only numeric official channel IDs synchronize; extra local channels persist separately. Actual cloud persistence is unverified.',
};

function family(method) {
  const name = method.name;
  if (/^(list_accounts|login_as|save_account|persist_current_account|remove_account|check_login|login_by_|send_sms)/.test(name)) return 'authentication_and_local_accounts';
  if (/(goods|product_album)/.test(name)) return 'goods_and_product_albums';
  if (/secondhand/.test(name)) return 'secondhand';
  if (/collection|favorite|unfavorite/.test(name)) return 'collections_and_favorites';
  if (/album/.test(name)) return 'app_albums';
  if (/dyh/.test(name)) return 'official_channels';
  if (/event/.test(name)) return 'events';
  if (/question|answer|vote/.test(name)) return 'questions_and_polls';
  if (/live_photo|upload|resolve_video|proxy_weibo|image_data|external_page/.test(name)) return 'media_and_uploads';
  if (/live/.test(name)) return 'live_broadcasts';
  if (/product|config_compare|rating_status/.test(name)) return 'digital_products';
  if (/apk|app_|game|download/.test(name)) return 'applications_and_games';
  if (/topic|tag|board|device_feed/.test(name)) return 'topics_and_boards';
  if (/notification|message|chat/.test(name)) return 'notifications_and_private_messages';
  if (/black_list|ignore_list|limit_list|user_|_user$|follower|follow_user|fans_user|hit_history|recent_history|profile|avatar|plugins|card_|tab_config|load_config/.test(name)) return 'profiles_relationships_and_preferences';
  if (/search/.test(name)) return 'search_and_suggestions';
  if (/create_feed|create_forward|update_feed|delete_feed|delete_reply|reply_feed|like_feed|like_reply|unlike/.test(name)) return 'publishing_and_interactions';
  if (/feed|replies|index|headline|update_list|digest|picture/.test(name)) return 'feed_discovery_and_reading';
  return 'transport_and_discovery_configuration';
}
const audit = publicMethods.map(method => {
  const referenceEndpoints = routes(method), mapping = mappings.get(method.name);
  const implementationCandidates = backend.filter(file => referenceEndpoints.some(endpoint => file.source.includes(endpoint))).map(file => file.path);
  const uiCandidates = mapping ? frontend.filter(file => mapping.operation.split(' / ').some(op => file.source.includes(op.replace(/^action /, '')))).map(file => file.path) : [];
  const live = mapping && liveChecks.find(check => mapping.operation.split(' / ').includes(check.operation) && check.state === 'verified');
  return { function: method.name, line: method.line, family: family(method), referenceEndpoints, referenceDescriptors: method.descriptors, protocolState: referenceEndpoints.length ? 'known_reference' : 'helper_or_not_extracted', status: live ? 'verified' : mapping ? 'implemented' : 'unknown', ...(mapping ? { operation: mapping.operation, scope: mapping.scope } : {}), verification: live ? { mode: 'guest_public_read_only_live', operation: live.observedVariant || live.operation, evidence: live.evidence || (live.operation.startsWith('secondhand') ? 'research/secondhand-live-checks.json' : ['homeNews', 'homeDigest', 'hotReplies', 'rank.favorite', 'rank.index'].includes(live.operation) ? 'research/discovery-live-checks.json' : 'research/catalog-live-checks.json'), authenticatedLive: false, limitation: 'Only this named operation was observed; other mapped aliases remain source/mock evidence.' } : { mode: mapping ? 'source_review_and_module_mock_checks_only' : 'no_workflow_verification', authenticatedLive: false }, nativeUi: { status: uiCandidates.length ? 'implementation_candidate_requires_workflow_check' : mapping?.scope !== 'native' && mapping ? 'not_a_native_feature' : 'unknown', candidates: uiCandidates }, implementationCandidates, limitation: mappingLimits[method.name] || 'Mapping or endpoint overlap does not establish complete feature parity, all filters, every mutation, or authenticated server behavior.' };
});
const groups = [...new Set(audit.map(entry => entry.family))].sort().map(name => ({ family: name, functions: audit.filter(entry => entry.family === name).map(entry => entry.function), count: audit.filter(entry => entry.family === name).length }));
const unknownReferenceMethods = audit.filter(entry => entry.status === 'unknown');

const apiOnly = new Set(['catalogAppTag', 'catalogAppUrl', 'catalogAppQr']);
const contracts = [...catalogContracts, { operation: 'catalogAppVersions', endpoint: '/v6/apk/downloadVersionList', prerequisites: ['/v6/apk/detail'], method: 'GET', authenticated: false, list: true }, { operation: 'catalogProductReview', endpoint: '/v6/feed/createFeed', method: 'POST', authenticated: true }, { operation: 'questionAnswer', endpoint: '/v6/feed/createFeed', method: 'POST', authenticated: true }];
const catalogCapabilities = {
  schemaVersion: 1, checkedAt, family: 'catalog', reference: { repository: 'daimiaopeng/coolapk-desktop', license: 'MIT', source: 'src-tauri/src/coolapk/client.rs', sha256: hash(source), limitation: 'An unofficial reference client is protocol evidence, not an exhaustive specification of the supplied official APK.' },
  stateDefinitions: { implemented: 'Desktop protocol exists and fixed-route mock contract passes; this alone is not live server verification.', verified: 'Only the named guest read operation was observed against official service; authenticated actions remain unverified.', unknown: 'No adequate protocol or native workflow evidence yet; does not mean unsupported.' },
  implementation: ['core/catalog.mjs', 'src/Catalog.tsx', 'src/catalog.css', 'src/Community.tsx'],
  operationCount: catalogOperations.length,
  operations: contracts.map(contract => { const live = liveChecks.find(check => check.operation === contract.operation && check.state === 'verified'); return { ...contract, status: live ? 'verified' : 'implemented', verification: { protocolMock: 'tests/catalog.test.mjs', publicLive: !!live, authenticatedLive: false, rendererMock: !apiOnly.has(contract.operation) ? 'research/catalog-ui-checks.json or research/community-checks.json; see feature-specific checks' : 'none' }, nativeUi: apiOnly.has(contract.operation) ? 'pending dedicated UI' : 'implemented; native workflow completeness still requires phone comparison' }; }),
  featureGroups: [
    { feature: '数码资料与参数对比', status: 'implemented', nativeUi: '分类/品牌/搜索、产品资料、服务端tabList/子板块、可购买版本、同机型和跨机型最多四款参数对比、差异高亮、账号对比增删', knownLimits: ['getVersionList 用于版本浏览及到手价发布配置；未知栏目和子板块筛选语义仍待确认', '云端对比完整列表/批量操作未确认'] },
    { feature: '想买/关注/已买与点评', status: 'implemented', nativeUi: '想买与关注独立开关、评分与带 buy_status 的点评、星级/拥有者过滤、想买和已买酷友、日周月评分趋势与拥有者样本', knownLimits: ['单独已买切换接口未知，已买仅通过已确认评分提交字段实现', '真实账号状态和评分写入未验证'] },
    { feature: '应用与游戏', status: 'implemented', nativeUi: '信息、截图、历史版本、相关应用、开发者应用、发现者、评分酷友、礼包、收藏、评分与评论', knownLimits: ['应用当前/历史版本下载队列、官方下载校验、本地进度/取消/重试与 USB 安装交接已实现并模拟检查；真实官方下载和 USB 安装未验证', 'APK 二维码仍为协议能力；第三方镜像/拆分安装包/签名认证尚未适配；断点续传仅在强文件标识与范围一致时使用'] },
    { feature: '应用集', status: 'implemented', nativeUi: '热门/最新/搜索/我的应用集、详情、评论浏览、创建与所有者编辑、本地封面图片上传、添加应用和确认移除', knownLimits: ['删除整个应用集、应用集评论提交/点赞/订阅协议尚无足够证据', '本地封面使用已确认 album 上传契约和模拟检查；真实账号上传未验证'] },
    { feature: '酷安号', status: 'implemented', nativeUi: '列表、详情、关注、我关注/订阅/管理的号、文章和广场，长文 FeedCard 阅读', knownLimits: ['号管理和编辑文章发布入口未完成', '管理列表读取不等于具备完整管理功能'] },
    { feature: '活动', status: 'implemented', nativeUi: '活动列表、详情说明、官方参与页面入口', knownLimits: ['活动报名/撤销/领奖等原生流程协议未知，外部参与页面不计完整复刻'] },
    { feature: '酷图', status: 'implemented', nativeUi: '标签分页、FeedCard 或画廊、图片预览', knownLimits: ['原图保存、文字分享卡/Markdown/JSON导出、实况照片读取与成对上传、feed/reply/article图库挂载已实现并模拟检查', '实况编解码兼容与官方账号上传未验证；HDR显示/编辑和所有原生分享目标仍未知'] },
    { feature: '问答与投票参与', status: 'implemented', nativeUi: '社区详情中的回答排序、关注/取消、邀请 UID、图文回答、选项约束、匿名投票和结果', knownLimits: ['普通账号提问/投票创建另有 APK 契约和原生编辑器；已发布编辑仍待验证', '真实投票/邀请/回答写入未验证'] },
  ],
  unknown: [
    { feature: '活动报名/领奖', status: 'unknown', protocolState: 'unknown', reason: 'Only list/detail and external participation URLs found in reference.' },
    { feature: '提问/投票创建编辑', status: 'partial', protocolState: 'partial_apk_recovered', reason: 'Normal-account creation fields and editors are recovered and implemented; published editing and administrative permissions remain unverified.' },
    { feature: '应用集删除/评论写入/订阅', status: 'unknown', protocolState: 'unknown', reason: 'No confirmed reference methods for these mutations.' },
    { feature: '举报表单真实提交', status: 'partial', protocolState: 'official_mobile_web_caller_recovered', reason: 'The official APK uses the recovered fixed report web form; desktop isolates the same targets and account context. Actual submission and availability are unverified; this is not a native report API.' },
    { feature: '二手发布/编辑/下架与交易履约', status: 'partial', protocolState: 'partial_apk_recovered', reason: `${SECONDHAND_PUBLISHING_OPERATIONS.length} fixed publishing/config/agreement/edit/close/state operations and SecondhandEditor have source/mock evidence. Inspect the independent publishing report for checked UI scenarios. Real account acceptance, unsupported media/permission variants and order/payment/refund/receipt workflows remain pending.` },
    { feature: '好物清单整单删除', status: 'unknown', protocolState: 'unknown', reason: 'Product-album detail/edit/owned deletion are now recovered and implemented separately. Dedicated goodsList whole-list deletion and linked-object cleanup semantics remain unconfirmed.' },
    { feature: '已发布产品专辑真实账户验收', status: 'partial', protocolState: 'apk_recovered', reason: 'feed/detail productAlbumDetailInfo, productAlbum/edit full indexed fields, ordinary/ladder types 1/2 and owner-gated feed/deleteFeed are implemented. 21 unit and 23 isolated UI checks passed; real server acceptance remains unverified.' },
  ],
  validation: { protocolTestEvidence: ['tests/catalog.test.mjs', 'tests/album-cover.test.mjs'], rendererChecks: uiChecks, publicReadOnlyLiveChecks: liveChecks, evidence: ['tests/catalog.test.mjs', 'tests/album-cover.test.mjs', 'scripts/test-catalog.mjs', 'scripts/probe-catalog.mjs', 'research/catalog-ui-checks.json', 'research/catalog-live-checks.json'], realAccountWrites: false },
};

const gap = (feature, priority, protocolState, implementationState, endpoints, evidence, nextStep, extra = {}) => ({ feature, priority, protocolState, implementationState, endpoints, evidence, verificationState: 'authenticated_live_unverified', nextStep, ...extra, status: implementationState });
const gaps = [
  gap('我的总览/更多快捷编辑/装备/抽奖/备份/看看号', 'P1', 'partial_apk_recovered', 'partial', ['/v6/user/space', '/v6/backList/list', '/v6/backList/detail', '/v6/backList/delete', '/v6/user/dyhFollowList', '/v6/user/editorDyhList'], ['research/mobile-ui-baseline.json; research/personal-native.md; research/account-overview-checks.json; research/parity-integration-checks.json.'], 'Native quick-entry editing, four personal digital categories, own product lists, cloud backup list/detail/delete and two personal Kankan categories are implemented. Android backup creation/restoration uses phone collaboration. Equipment and lottery desktop-native read/write contracts remain unknown: their official H5 URLs and Android product-selection bridge do not establish save/share/API semantics. Anonymous equipment H5 returned HTTP 567 and the phone did not expose WebView debug assets. Experience denominator and account eligibility remain pending; desktop authenticated acceptance is blocked by the official login site.', { remainingUnknown: ['Equipment native read/edit/save/share contracts', 'Lottery native entries/results/participation contracts', 'Backup creation packageInfo and phone restoration semantics', 'Exact experience denominator and permission-dependent personal entries'] }),
  gap('界面配色/材质/图片水印/默认排序', 'P1', 'partial_apk_recovered', 'partial', ['/v6/account/loadConfig', '/v6/account/updateConfig'], ['research/settings-capabilities.json; research/settings-native-checks.json; research/image-settings-ui-checks.json; research/desktop-effects-ui-checks.json; research/settings-lab-youth-contracts.json; research/apk-request-bindings.json.'], 'Recovered phone palettes and independent custom theme/accent/style, actual full/blur_only/fallback modal/toast materials, rapid return-to-top, frame-based FPS, original-image preferences and Live Photo audio have working desktop consumers. Cloud watermark patch/readback and signed OSS processing have synthetic checks. Real cloud/OSS acceptance and watermark pixels, full HDR fidelity, default node sorting, headline cache/recommendation consumers, language and remaining laboratory autoplay/phone inventory/push logs still require implementation or verification.', { implementedScope: 'Native palettes/custom editor/materials/return-to-top/FPS and image preferences; seven isolated DesktopEffects groups', remainingUnknown: ['Authenticated image/cloud acceptance and HDR pixel fidelity', 'Default node sorting and headline cache/related recommendation consumers', 'Laboratory WiFi autoplay and Android push logging/phone app inventory', 'Language and exact complete mobile screen parity'] }),
  gap('青少年模式主进程限制与精选内容', 'P1', 'apk_recovered', 'partial', ['/v6/page/dataList', '/v6/feed/detail'], ['research/settings-lab-youth-contracts.json; tests/teenager.test.mjs; tests/teenager-access.test.mjs; research/teenager-ui-checks.json; research/teenager-native-checks.json.'], 'Local four-digit PIN with salted verifier, current-account logout, foreground 40-minute quota, 22:00–06:00 restriction, fail-closed persistence, guest-only V12_TEENAGER and source-ID/image authorization are implemented. Eight actual built main/preload/App groups exercised Windows safeStorage, IPC rejection before side effects, PIN change/exit, clock limits and encrypted restart using blocked external requests. Verify official curated availability and all native curated cards; phone mode was not changed.', { verificationState: 'native_local_verified_remote_curated_unverified', localNativeCheckCount: teenagerNativeChecks.length, authenticatedLive: false, remainingUnknown: ['Official curated endpoint availability', 'Full native curated-card inventory and content parity'] }),
  gap('通知徽标聚合与系统后台推送', 'P1', 'apk_recovered', 'partial', ['/v6/notification/checkCount'], ['research/notification-badge-contracts.json; core/notifications.mjs; tests/notifications.test.mjs; src/App.tsx; research/account-settings-contracts.json.'], 'The recovered notification tab aggregate is max(0, notification_v18 + (notification_ignore_like_count ? 0 : feedlike)); combined count adds message. Individual like counts stay intact and aggregate-only responses do not authorize guessed subtraction. Native account settings control the cloud subscription fields; system background notification transport and Android installation/update reminders remain separate missing consumers.', { remainingUnknown: ['Windows system background push delivery', 'Android installation/update reminder cooperation', 'Exact aggregation when the service omits notification_v18/feedlike'] }),
  gap('首页节点/用户/关键词屏蔽配置', 'P1', 'apk_recovered', 'partial', ['/v6/user/spamWordList', '/v6/account/updateConfig'], ['Official business caller and Retrofit annotations; core/personal.mjs; core/personal-models.mjs; tests/personal.test.mjs; scripts/test-personal.mjs; research/parity-integration-checks.json.'], 'Native node/user/keyword reads, search selection, exact diff writes, readback, idempotent retry and headline-only filtering are implemented. Complete authenticated roundtrip and all returned node variants; this configuration is distinct from general user-ignore actions.'),
  gap('举报动态/评论/用户/应用', 'P0', 'official_mobile_web_caller_recovered', 'partial', ['https://m.coolapk.com/mp/do', 'https://m.coolapk.com/mp/apk/report'], ['research/official-web-flows.json; electron/report-flow.cjs; tests/report-flow.test.mjs; research/parity-integration-checks.json.'], 'The APK itself opens the official report form. Desktop opens the same fixed feed/article/comment/user/app targets in an isolated authenticated window with account-change cleanup. Real form availability and submission are unverified; no reports are automatically submitted and this web workflow is not counted as a native report API.'),
  gap('创建/编辑提问', 'P0', 'partial_apk_recovered', 'partial', ['/v6/feed/createFeed', '/v6/feed/relatedQuestion'], ['research/creation-contracts.json; core/creation.mjs; src/Creation.tsx; tests/creation.test.mjs; research/creation-checks.json.'], 'Native normal-account question creation includes normalized title, body, images, similar questions, draft, mentions/topics, target and visibility. Validate actual permission/challenge/publish/delete workflows. Published-question edits and privileged or bounty variants remain unconfirmed.'),
  gap('创建/编辑投票', 'P0', 'partial_apk_recovered', 'partial', ['/v6/feed/createFeed', '/v6/vote/createUserVote'], ['research/creation-contracts.json; core/creation.mjs; src/Creation.tsx; tests/creation.test.mjs; research/creation-checks.json.'], 'Native ordinary and PK poll creation supports confirmed option/title limits, single/multiple choices, deadline and draft isolation. Validate real writes and permissions. Published-poll editing and role-dependent administrative fields remain pending; participation is a separate API.'),
  gap('二手发布/编辑/下架与交易详情', 'P0', 'partial_apk_recovered', 'partial', ['/v6/erShou/categoryList', '/v6/erShou/config', '/v6/erShou/configList', '/v6/erShou/agreementDetail', '/v6/erShou/checkAgree', '/v6/erShou/agreement', '/v6/erShou/checkUrl', '/v6/feed/createFeed', '/v6/feed/changeDetail', '/v6/feed/changeFeed', '/v6/erShou/changeStatus', '/v6/feed/detail'], ['core/secondhand-publishing.mjs; core/secondhand-publishing-models.mjs; src/SecondhandEditor.tsx; tests/secondhand-publishing.test.mjs; research/apk-request-bindings.json. Existing browsing evidence is tracked separately in research/secondhand-capabilities.json.', ...secondhandPublishingEvidence], `${SECONDHAND_PUBLISHING_OPERATIONS.length} fixed native operations cover recovered categories/config/presets, timed agreement read and explicit acceptance, validated transaction link, ordinary listing creation, current-owner editing, status=-1 close and owner-only readback status. Source implementation and named isolated checks establish partial native coverage without any real account publish/edit/close. Inspect the separate publishing report for completed renderer scenarios. Unsupported media/identity/config variants, precise mobile body limits, automatic phone geolocation transfer, orders, payments, refund and receipt remain pending.`, { implementedScope: `${SECONDHAND_PUBLISHING_OPERATIONS.length} source-recovered publishing/config/agreement/edit/close/state operations and native SecondhandEditor`, remainingUnknown: ['Authenticated agreement/create/edit/close acceptance and cleanup', 'Unsupported media/config/identity or permission variants', 'Exact mobile body limits and automatic phone geolocation transfer', 'Orders, payment, refund and receipt workflows'] }),
  gap('实况照片读取', 'P0', 'known_reference', 'implemented', ['/v6/livePhoto/showVideo'], ['resolve_live_photo_video:4130; core/live-photo.mjs; src/LivePhoto.tsx; src/photo-items.ts; research/live-photo-checks.json and research/photo-gallery-checks.json.'], 'Resolver, playback and feed/reply/article gallery metadata mounting are implemented with context-specific mock checks. Test official live media without writes and investigate codecs; get_live_photo_video_header adaptation and HDR remain unverified.', { contract: { method: 'GET', query: ['picUrl (original http image.coolapk.com URL)', 'id={feed|reply|article}_{contentId}'], response: '302 Location or JSON URL; no cross-host credential forwarding' } }),
  gap('实况照片发布/HDR', 'P0', 'known_reference', 'partial', ['/v6/upload/ossUploadPrepare'], ['upload_image_with_live:6166; core/live-photo.mjs uploadLivePhoto; src/Attachments.tsx per-image MP4/MOV binding. Paired upload mock verified; no real upload performed.'], 'Paired still/video metadata, video-first signed OSS PUT, no static fallback and account-switch cancellation are implemented. HDR UI/display, private-message pairing and real account upload verification remain pending.'),
  gap('自有图文文章编辑', 'P0', 'known_reference', 'implemented', ['/v6/feed/changeDetail', '/v6/feed/changeFeed'], ['core/publishing.mjs editArticle; src/Composer.tsx ArticleEditor.'], 'Exercise real server change permissions and preserve all supported/unknown original article models; source implementation and mock result are not end-to-end ownership verification.'),
  gap('自有视频编辑/替换封面', 'P0', 'unknown', 'missing', ['/v6/feed/changeDetail', '/v6/feed/changeFeed'], ['Reference update_feed explicitly rejects media; editArticle also rejects media.'], 'Determine permitted video edits and media-info replacement from official app; do not apply ordinary article form to video.'),
  gap('完整好物清单与商品动态', 'P1', 'partial_known_reference_and_apk', 'partial', ['/v6/goods/searchHotWords', '/v6/goods/search', '/v6/goods/addGoods', '/v6/goods/detail', '/v6/goodsList/listType', '/v6/goodsList/list', '/v6/goods/goodsStoreItemList', '/v6/goodsList/create', '/v6/goodsList/edit', '/v6/goodsList/addGoods', '/v6/goodsList/deleteItems', '/v6/goodsList/editGoodsItem', '/v6/goodsList/vote', '/v6/goodsList/bindFeedToGoodsList'], ['client.rs:8571-8870; core/goods.mjs; src/Goods.tsx; tests/goods.test.mjs (21 cases across goods and product albums); research/goods-ui-checks.json (23 isolated groups).'], 'Known search/detail, list create/edit, item add/edit/remove, vote/cancel and owned-feed binding are implemented. Product-album create/detail/edit/delete are separately recovered and tested. Confirm live goods permissions and dedicated goodsList whole-list deletion semantics; loaded-page categories/ranking are not a server-wide ranking claim.', { implementedScope: '21 combined goods/product-album operations; exact parent-feed/list/member-feed/item IDs; owner rechecks; frozen verification retries; account draft isolation; unconfirmed creates cannot be automatically replayed', remainingUnknown: ['Dedicated goodsList whole-list delete and linked-object behavior', 'Real account goods conversion/mutations', 'Server-wide ranking and unavailable metadata variants'] }),
  gap('产品专辑', 'P1', 'apk_recovered', 'partial', ['/v6/user/productAlbumList', '/v6/feed/detail', '/v6/productAlbum/create', '/v6/productAlbum/edit', '/v6/feed/deleteFeed'], ['research/apk-request-bindings.json; research/goods-capabilities.json; core/goods.mjs; src/Goods.tsx; tests/goods.test.mjs; research/goods-ui-checks.json. Official ProductAlbumRepository/AnythingListActionHelper/FeedUserSheetGroupFactory/ConfirmDeleteDialog callers are recovered in ignored .local.'], 'Actual feed/detail productAlbumDetailInfo drives native detail. Ordinary type=1 and ladder type=2, complete indexed item fields, custom/linked products, reorder/add/remove, preserved IDs/images/association and five ladder levels are implemented. Published edits recheck owner, enableModify=1, history, fresh item membership and old-node relation; deletion confirms and rechecks owner before POST feed/deleteFeed id/notNotify=0. Captcha payload and account-change isolation are covered by 21 unit and 23 UI groups. Validate actual server acceptance and cleanup; protected administrator blackType values and unknown types are not fabricated.', { implementedScope: 'Native creation/detail/owner editing/confirmed owner deletion for official ordinary and ladder lists', remainingUnknown: ['Actual account create/edit/delete acceptance, durable results and cleanup', 'Privileged/admin deletion blackType and eligibility', 'Other product-album types and unrecognized server variants'] }),
  gap('分享卡片/图片导出/保存原图与收藏导出', 'P1', 'local_workflow_or_unknown_server', 'partial', [], ['src/Sharing.tsx; electron/local-files.cjs; tests/local-files.test.mjs; research/sharing-checks.json (6 mock workflows).'], 'Markdown/JSON feed and paginated collection export, selectable official feed images, previewed PNG image/text cards, clipboard links and original-photo save are implemented. Full mobile card templates, system share targets and real save dialogs remain unverified; no real user exports performed.', { status: 'implemented', implementedScope: 'Named local export/share workflows only; export refuses incomplete pagination', remainingUnknown: ['Full mobile image-rich card templates, QR and hot-comment layout parity', 'Full mobile share-sheet integrations', 'Live filesystem dialog workflow'] }),
  gap('应用后台下载/校验/历史版本下载/USB 安装更新', 'P1', 'known_reference', 'partial', ['/v6/apk/url', '/v6/apk/downloadVerify', '/v6/apk/downloadVersionList', '/v6/apk/qr'], ['core/download.mjs; electron/download-manager.cjs; src/Downloads.tsx; research/download-capabilities.json; research/download-checks.json (7 renderer workflows); tests/download.test.mjs and tests/download-manager.test.mjs.'], 'Current/history planning, downloadVerify, persistent queue, pause/continue, strong-ETag/If-Range continuation bound to original resource URI hash and saved partial SHA-256, cancellation/restart and explicit USB install handoff are implemented. Verify official availability/range support/device install and publisher signature; mock files do not establish real APK availability.', { status: 'implemented', localFileChecks: 'Injected mock APK streams write isolated test files; no official APK download or USB install', remainingUnknown: ['Real official current/history availability', 'Background verification challenge replay', 'Split APK/mirrors and live server range support', 'Independent publisher-signature verification'] }),
  gap('酷安号创建/管理/文章编辑发布/订阅管理', 'P1', 'partial_known_reference', 'partial', ['/v6/user/editorDyhList', '/v6/dyh/detail', '/v6/dyhArticle/list', '/v6/dyh/follow', '/v6/dyh/unFollow'], ['Read/follow operations exist; editor list and feed dyhId fields alone do not establish administration.'], 'Inspect official admin and publish workflows and role permissions; implement only confirmed methods and preserve per-account permissions.'),
  gap('活动报名/撤销报名/领奖', 'P1', 'unknown', 'missing', ['/v6/event/list', '/v6/event/detail'], ['Reference only contains list/detail.'], 'Inspect each native event type and supported official web flows; label external steps accurately, do not count external entry as native implementation.'),
  gap('应用集完整互动/删除/封面上传', 'P1', 'partial_known_reference', 'partial', ['/v6/album/detail', '/v6/album/create', '/v6/album/edit', '/v6/album/addApk', '/v6/album/delApk', '/v6/album/replyList', '/v6/upload/ossUploadPrepare'], ['Catalog supports create/edit/app removal, reading replies and local cover upload using uploadBucket=album/uploadDir=album/feed_type=empty; tests/album-cover.test.mjs and research/catalog-ui-checks.json.'], 'Local cover selection and upload retry are implemented with source/mock evidence; verify actual cover upload with an authorized test account. Discover native delete/comment/subscribe permissions and routes before completing interaction UI.'),
  gap('搜索建议/发布话题/最近标签与应用专属搜索', 'P1', 'known_reference', 'partial', ['/v6/search/suggestSearchWordsNew', '/v6/feed/searchTag'], ['core/search.mjs; src/SearchSuggestions.tsx; src/search-targets.ts; src/PublishOptions.tsx; tests/search.test.mjs; scripts/test-search-ui.mjs.'], 'Typed general/app suggestions, keyboard navigation, debounce, stale-response guards and exact feed/searchTag recentIds topic lookup are implemented. Compare native ranking, tag forms and all suggestion target types; unrecognized descriptors remain explicit gaps.', { status: 'implemented', implementedScope: '3 fixed search operations and native renderer integration', remainingUnknown: ['Full mobile suggestion target inventory', 'Authenticated topic eligibility/recent history parity'] }),
  gap('首页/发现配置与头条精选/更新列表/完整服务端栏目', 'P1', 'known_reference', 'partial', ['/v6/main/init', '/v6/main/headline', '/v6/main/updateList', '/v6/feed/editorChoiceList', '/v6/page/dataList'], ['core/home.mjs; src/HomeChannels.tsx; core/client.mjs init/page; tests/home-channels.test.mjs; research/channel-checks.json (named read-only descriptor samples).'], 'Native home channels, headlines/editor choice/updates, local sorting/visibility and exact home_tab_config cloud form are implemented. Inventory every official returned descriptor/card and account load/save persistence; numeric official IDs only sync, and generic dispatch does not prove full native discovery coverage.', { status: 'implemented', remainingUnknown: ['Every server descriptor/card and permission-dependent state', 'Real account home_tab_config roundtrip'] }),
  gap('用户二维码/关注圈子与其它主页分页', 'P1', 'known_reference', 'partial', ['/v6/user/qrImage', '/v6/user/forumFollowList'], ['core/account.mjs accountQr/accountFollowNodes/accountTabData; src/AccountCenter.tsx; tests/account-readonly.test.mjs; tests/account-public-identity.test.mjs.'], 'Current-account workflows and target-user QR, followed circles, homepage cards and fixed public-content pagination are implemented. Guests use isolated public clients; optional tabs follow returned metadata and no private tabs are inferred. Verify official target-user QR eligibility and visibility; source and synthetic UI checks are not live acceptance.', { status: 'implemented', remainingUnknown: ['Official other-user QR eligibility and public-tab visibility', 'Native private/deleted content visibility'] }),
  gap('受限列表解除与异常动态管理', 'P1', 'partial_known_reference', 'partial', ['/v6/user/limitList', '/v6/feed/spamFeedList'], ['accountUsers limit read-only; accountSpamFeeds GET /v6/feed/spamFeedList; src/AccountCenter.tsx; tests/account-readonly.test.mjs.'], 'Known spam-feed list and restricted-user list UI are implemented. Discover appeal/remediation/unrestrict contracts from native app; no removal route inferred.', { status: 'implemented', remainingUnknown: ['Restricted list release', 'Spam appeal/remediation mutations'] }),
  gap('独立评论编辑/评论详情导航', 'P1', 'unknown', 'partial', ['/v6/feed/replyDetail'], ['src/App.tsx preserves __replyId from native rid deep links; src/Detail.tsx fetches and focuses replyDetail; research/sharing-checks.json.'], 'Exact comment-target deep-link navigation and own-comment delete are implemented. Author edit contract is still unknown; verify permission-dependent native capability before adding an edit action.', { status: 'implemented', remainingUnknown: ['Independent comment edit mutation', 'Official live nested-comment navigation'] }),
  gap('产品专属子板块与完整对比管理', 'P1', 'known_reference', 'partial', ['/v6/product/getVersionList', '/v6/page/dataList', '/v6/product/addConfigCompare', '/v6/product/removeConfigCompare'], ['core/catalog.mjs; src/Catalog.tsx; research/product-workflow-checks.json confirms server subtab navigation, exact same-product rating descriptors, star/owner filters, default/latest/hot feeds and image/video/recommended media.'], 'Known subtab, rating sort/filter, media and local comparison flows are implemented. Cloud comparison list read/sync and unknown descriptors still lack verified contracts; add/remove operations do not establish complete cloud compare management.'),
  gap('平台账户安全/昵称/手机号/隐私通知配置', 'P1', 'partial_known_reference_and_apk', 'partial', ['https://account.coolapk.com/account/changeUsername', '/v6/account/loadConfig', '/v6/account/updateConfig'], ['research/account-settings-contracts.json; research/account-settings-ui-checks.json; core/account-settings.mjs; core/account-settings-models.mjs; src/AccountSettings.tsx; tests/account-settings.test.mjs; research/mobile-ui-baseline.json.'], 'Exact GET account/loadConfig key=system_config and POST account/updateConfig key/value patch contracts now support 10 privacy and 10 notification fields with recovered enum values, current restrictions, one-setting writes, guard-derived timestamp, explicit confirmations, idempotence, readback and account-switch/captcha boundaries. Fourteen unit and fourteen isolated UI groups passed. Account credential/binding/security flows, actual cloud propagation, local Android-only clipboard/ads/install/reminder controls and consent withdrawal remain separate gaps.', { implementedScope: '20 native cloud-setting fields via accountSettings/accountSettingsUpdate; local history and notification badge consumers integrated', remainingUnknown: ['Authenticated cloud acceptance and cross-device propagation', 'Complete account binding/security and username/mobile changes', 'Android-only local controls and privacy-consent withdrawal', 'Windows background push delivery'] }),
  gap('广播完整流格式/弹幕/聊天室', 'P1', 'partial_known_reference', 'partial', ['/v6/live/detail', '/v6/live/follow', '/v6/live/unFollow'], ['Community implements reservation and directly supported live/playback URLs.'], 'Compare native chat/danmaku, playback qualities and unsupported stream formats; list/detail do not establish chat protocol.'),
  gap('全部写入操作的真实账户回归', 'P0', 'known_reference', 'partial', [], ['All desktop mutations use mock clients; no real social/account-content writes performed. One phone reply-notification subscription was explicitly selected by the user; it does not validate any desktop mutation.'], 'The user authorized creation and cleanup on the test account, which is logged in only on the phone. Official desktop login is currently blocked by EdgeOne 567 even after matching the default APK login URL. After desktop authentication succeeds, validate real permissions, verification retries, durable response IDs, server-visible results and cleanup.'),
];
const apkBindings = json('research/apk-request-bindings.json');
const nativeAudit = json('research/native-api-audit.json');
const report = { schemaVersion: 1, checkedAt, officialApk: { evidence: 'research/apk-request-bindings.json', sha256: apkBindings?.apkSha256, recoveredRequestCount: apkBindings?.contracts?.length || 0, businessDexMapCount: apkBindings?.businessDexMapCount, fixedMethodAudit: { evidence: 'research/native-api-audit.json', compared: nativeAudit?.comparedRequestCount, mismatches: nativeAudit?.mismatches?.length }, limitations: ['Reconstructed static maps/annotations and selected callers only; protected structures remain explicit unknowns.', 'A method match does not prove all parameter fields or live account acceptance.'] }, goal: 'All native community features of official Coolapk APK', completion: 'incomplete', methodology: ['Enumerated every pub async fn in the MIT reference client (251 total), extracted complete bodies with Rust string/comment masking, followed self/Self helper calls for route evidence.', 'Manual method-to-operation mappings are source coverage, not complete UI parity. Unmapped endpoint occurrences are retained as implementation candidates only.', 'Mock and public read-only live checks are named separately. No real desktop account writes, report submissions, posts, votes or deletions executed; the official phone reply-notification prompt was accepted only after an explicit user choice.', 'Phone mirroring is limited to authorized Android-exclusive operations. Official forms that the APK itself embeds are retained as web workflow parity and are not counted as a native API implementation.', 'The reference is not an exhaustive mobile APK specification. Absent endpoints remain unknown rather than unsupported.', 'Authenticated official 16.6.4 phone screen/control inventory is recorded separately in research/mobile-ui-baseline.json; UI observation does not establish a request contract or authenticated desktop acceptance.'], reference: { repository: 'daimiaopeng/coolapk-desktop', license: 'MIT', source: 'src-tauri/src/coolapk/client.rs', sha256: hash(source), publicAsyncFunctionCount: publicMethods.length }, snapshot: { modules: backend.map(file => ({ path: file.path, sha256: hash(file.source) })), ui: frontend.map(file => ({ path: file.path, sha256: hash(file.source) })) }, stateDefinitions: catalogCapabilities.stateDefinitions, workflowEvidence, supplementalNativeWorkflows: [{ feature: 'share_export_original_photo_and_comment_target', status: 'implemented', implementation: ['src/Sharing.tsx', 'electron/local-files.cjs', 'src/Detail.tsx', 'src/App.tsx'], evidence: ['research/sharing-checks.json', 'tests/local-files.test.mjs'], authenticatedLive: false, limitations: ['Selected feed-image and text share cards; not all mobile templates or system share targets', 'File save mock/local fixture checks are distinct from real user export', 'Independent comment edit protocol remains unknown'] }], goodsContractCount: GOODS_CONTRACTS.length, goodsRendererCheckCount: goodsChecks.length, counts: { referenceFunctions: audit.length, mappedSourceImplementations: audit.filter(entry => entry.status !== 'unknown').length, namedPublicLiveVerified: audit.filter(entry => entry.status === 'verified').length, unmappedReferenceMethods: unknownReferenceMethods.length, nativeFeatureGaps: gaps.length }, groups, functions: audit, unmappedReferenceMethods: unknownReferenceMethods.map(entry => ({ function: entry.function, family: entry.family, line: entry.line, referenceEndpoints: entry.referenceEndpoints })), gaps, requiredCompletionEvidence: ['Native screen/workflow checklist against installed official APK, including all permission-dependent states and account settings.', 'Exact request/response contracts for presently unknown mutations; never infer them solely from similar feed forms.', 'Contract tests plus synthetic native renderer checks for each new workflow.', 'User-authorized disposable-account end-to-end writes and durable server result verification.', 'Account switching, cancellation, captcha retry, deletion confirmation, network failure and denied-permission regressions.'] };
report.homeUiAudit = { evidence: 'research/home-mobile-audit.json', officialPhoneChannelsObserved: json('research/home-mobile-audit.json')?.channels?.length || 0, officialTopicCategories: json('research/home-mobile-audit.json')?.topicCategoryCount || 0, navigationEvidence: 'research/home-navigation-audit.json', authenticatedDesktopAcceptance: false, completion: 'incomplete' };
writeFileSync('research/catalog-capabilities.json', JSON.stringify(catalogCapabilities, null, 2) + '\n');
writeFileSync('research/parity-gaps.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ catalogOperations: catalogOperations.length, ...report.counts, output: ['research/catalog-capabilities.json', 'research/parity-gaps.json'] }));
