# Open Claude UI: pinned AEL browser adapter

Source: https://github.com/Caho1/open-claude-ui

Commit: `c1f923ae0051a871941b98a0e2e3183a545e6a85`

Upstream package version: `1.0.0`; local adapter version: `1.0.0-ael.1`.

This is an explicitly modified, browser-only subset, not the complete upstream
distribution. The upstream npm package was unavailable (registry E404) when
integrated. Install this checked-in package with `file:vendor/open-claude-ui`.
It is intentionally private and is not affiliated with Anthropic.

## Source mapping and modifications

- `styles/cds-theme.css` and `styles/cds-pure.css` are verbatim copies of
  `code-examples/cds-theme.css` and `code-examples/cds-pure.css` from the commit
  above. The relative theme import is preserved. These contain no proprietary
  fonts or recordings. Import `open-claude-ui/pure.css` (which includes tokens)
  and `open-claude-ui/components.css` once in the host.
- `src/CdsButton.tsx` adapts `code-examples/CdsButton.tsx`: preserves the outer
  control / inner paint layer, loading state and size/variant interface. Replaces
  Tailwind-specific classes with namespaced CSS to avoid Tailwind version or
  content-glob requirements; defaults `type` to `button` and adds `aria-busy`.
- `src/ChatComposer.tsx` adapts the structure, input handling and submit control
  from `code-examples/ChatComposer.tsx`, plus the measured textarea-height fallback
  from `code-examples/RichComposerWithMentions.tsx`. It removes demo attachments,
  hardcoded Claude models, synthetic slash commands and token estimates. The host
  owns `value`, draft persistence and successful clearing. The adapter guards
  duplicate submissions, retains text on error and displays a retryable error.
- `src/useComposerImeGuard.ts` extracts the composition/native isComposing/229
  checks from those two upstream composers, including the Apple-only 500 ms
  post-composition guard. Refs prevent stale composition-state captures.
- `src/useClaudeScrollPinning.ts` adapts
  `code-examples/useClaudeScrollPinning.ts`: retains the upstream 40 px / 120 px /
  150 ms thresholds, uses a ref for current pin state, cancels scheduled frames
  on unmount and respects reduced-motion preferences for explicit smooth jumps.
- `styles/components.css` is local compatibility glue for the adapted controls;
  it uses the upstream token names and paint-layer hierarchy.

The package exports no Electron/Node APIs, does not access the network, and has
no import-time browser side effects. It uses only the host's React/ReactDOM peers.
Its source TypeScript entry is handled directly by Vite; no postinstall or
third-party build script runs. No backend behavior is provided by these controls.

## Minimal usage

```tsx
import { ChatComposer, CdsButton, useClaudeScrollPinning } from 'open-claude-ui';
import 'open-claude-ui/pure.css';
import 'open-claude-ui/components.css';

<ChatComposer value={draft} onChange={setDraft} onSend={submit}
  disabled={!connected} isSending={sending} aria-label="任务内容" />;

// For a stream container, wire containerRef, handleScroll, and markUserInput
// to ref / onScroll / onWheel / onTouchMove. For keyboard scrolling, call
// markUserInput only for scroll keys, not for every keypress.
```

`ChatComposer.onSend` receives the trimmed nonempty string. It may return a
Promise. The host clears the draft only after a successful operation. Failed
Promises display an error and retain the draft. `CdsButton` accepts native
button attributes. `useClaudeScrollPinning` receives a fixed-length dependency
array whose values change when visible stream content changes.

Both the original implementation and this adapter are distributed under MIT;
retain the accompanying copyright and permission notice.

## Verification

From the AEL project root:

```text
node node_modules/typescript/bin/tsc --project vendor/open-claude-ui/tsconfig.json --noEmit
node vendor/open-claude-ui/tests/verify-interactions.mjs
```

The browser check starts an isolated Vite server on localhost port 15431 and
closes it afterward. It checks CJK composition, Shift+Enter, empty/disabled input,
draft retention after a rejected submission, in-flight duplicate prevention,
manual scroll preservation, explicit scroll-to-bottom and uncaught exceptions.
It does not call a model API, native IPC, or any external service.
