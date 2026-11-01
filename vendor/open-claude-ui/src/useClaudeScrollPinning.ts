// Adapted from upstream code-examples/useClaudeScrollPinning.ts.
// Retains 40 px pin tolerance / 120 px jump threshold / 150 ms input cooldown.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useClaudeScrollPinning(dependencies: readonly unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [isPinned, setIsPinned] = useState(true);
  const [showJumpControl, setShowJumpControl] = useState(false);
  const lastUserInputAt = useRef(Number.NEGATIVE_INFINITY);
  const programmaticScroll = useRef(false);

  const updatePinned = useCallback((value: boolean) => {
    pinnedRef.current = value;
    setIsPinned(value);
  }, []);

  const markUserInput = useCallback(() => {
    lastUserInputAt.current = performance.now();
    programmaticScroll.current = false;
    updatePinned(false);
  }, [updatePinned]);

  const handleScroll = useCallback(() => {
    if (programmaticScroll.current) {
      programmaticScroll.current = false;
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    updatePinned(distanceFromBottom <= 40);
    setShowJumpControl(distanceFromBottom > 120);
  }, [updatePinned]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = containerRef.current;
    if (!el) return;
    const prefersReducedMotion = typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    programmaticScroll.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !prefersReducedMotion ? 'smooth' : 'auto' });
    updatePinned(true);
    setShowJumpControl(false);
  }, [updatePinned]);

  useEffect(() => {
    if (performance.now() - lastUserInputAt.current <= 150 || !pinnedRef.current) return;
    // Wait for layout, and recheck user input so an in-flight frame cannot
    // override a wheel/touch gesture that happened after the render.
    const frame = requestAnimationFrame(() => {
      if (pinnedRef.current && performance.now() - lastUserInputAt.current > 150) scrollToBottom(false);
    });
    return () => cancelAnimationFrame(frame);
  }, dependencies);

  return { containerRef, isPinned, showJumpControl, markUserInput, handleScroll, scrollToBottom };
}
