# Account and search read operations

These features use fixed read routes recovered from the MIT reference source. No authenticated live account operation was used for validation.

`dispatchAccount` now handles `accountQr`, `accountFollowNodes`, `accountTabData` and `accountSpamFeeds`. Existing AccountCenter integration exposes the new panels with no additional props. All four operations require the current authenticated UID; a renderer-supplied UID or endpoint cannot redirect them.

The QR operation downloads `/v6/user/qrImage?uid=current` using the captured request client. It rejects redirects, non-raster MIME, mismatched image signatures, empty responses and declared or streamed bodies above 4 MiB. Its result is a data URL displayed in a namespace-bound modal, separate from the public image protocol/cache. The main process must continue asserting the captured epoch after dispatch finishes; closing or switching accounts invalidates the renderer request sequence.

Followed circles use `/v6/user/forumFollowList` with `uid`, `page`, `firstItem` and `lastItem`. The removed `customNodeList` route is not used. Personal content uses the fixed route table in `accountTabData`; 17 categories preserve original entities, including unfamiliar templates. Rating targets are constrained to `all`, `apk` and `product`. Recycle descriptors use the valid `?uid=` separator when the descriptor has no existing query string.

The abnormal feed panel reads `/v6/feed/spamFeedList` with `type`, `channel`, `spamType` and `subType` all set to `feed`. Some accounts need audit permissions. Permission/shape errors are visible and never converted to a successful empty result. Restore, appeal and restriction-removal endpoints were not inferred.

`dispatchSearch` exposes `searchSuggestions`, `searchSuggestionsApp` and `searchPublishTopics`. Root registers it before the client's fallback switch. The first two use `/v6/search/suggestSearchWordsNew`; only the app operation adds `type=app`. Publishing topics use `/v6/feed/searchTag` with `q`, `page` and `recentIds`; empty `q` deliberately reaches the server for recent/hot suggestions.

The global search component contract is:

```ts
type SearchSuggestionsProps = {
  query: string;
  namespace: string;
  inputRef: RefObject<HTMLInputElement | null>;
  active?: boolean;
  scope?: 'all' | 'app';
  onSelect: (selection:
    | { kind: 'search'; query: string; type: string }
    | { kind: 'entity'; entity: Entity }
    | { kind: 'link'; url: string }) => void;
  onDismiss?: () => void;
};
```

Render the component inside a positioned search container. Selection must pass searchTab's actual `keyword` and canonical category into the search page, known entities to the existing entity router, and safe links to the normal link handler. Root has integrated these paths and initializes search subtype from `page.type`. Input focus activates the component; dismissal clears the active state. The component supports Arrow/Enter/Escape, prevents outdated requests replacing suggestions, and leaves ordinary Enter search available on failure.

Validation can be reproduced with `node --test tests/account-readonly.test.mjs tests/search.test.mjs`, `node scripts/test-account-ui.mjs` and `node scripts/test-search-ui.mjs` after building. The native scripts run the real App with synthetic IPC responses and isolated userdata; screenshots stay in ignored `.local` directories and public reports omit credentials. API availability and account permissions remain explicitly unverified by live authenticated calls.
