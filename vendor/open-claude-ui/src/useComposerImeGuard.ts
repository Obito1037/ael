// Extracted and adapted from upstream ChatComposer.tsx and
// RichComposerWithMentions.tsx; see ../UPSTREAM.md and ../LICENSE.
import { useCallback, useRef, type CompositionEvent, type KeyboardEvent } from 'react';

export function useComposerImeGuard() {
  const composing = useRef(false);
  const lastCompositionEnd = useRef(Number.NEGATIVE_INFINITY);

  const onCompositionStart = useCallback(() => { composing.current = true; }, []);
  const onCompositionEnd = useCallback((event: CompositionEvent<HTMLTextAreaElement>) => {
    composing.current = false;
    lastCompositionEnd.current = event.timeStamp;
  }, []);
  const shouldIgnoreKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return true;
    // The upstream post-composition guard is restricted to Apple WebKit;
    // ordinary Enter on Windows must not incur an unnecessary 500 ms delay.
    const appleWebKit = typeof navigator !== 'undefined' && /Apple Computer/.test(navigator.vendor);
    return appleWebKit && Math.abs(event.timeStamp - lastCompositionEnd.current) < 500;
  }, []);

  return { onCompositionStart, onCompositionEnd, shouldIgnoreKeyDown };
}
