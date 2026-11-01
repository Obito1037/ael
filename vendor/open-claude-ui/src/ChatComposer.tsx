// Adapted from upstream ChatComposer.tsx / RichComposerWithMentions.tsx.
// Uses controlled AEL state instead of upstream demo attachments and models.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CdsButton } from './CdsButton';
import { useComposerImeGuard } from './useComposerImeGuard';

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (content: string) => void | Promise<void>;
  disabled?: boolean;
  isSending?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  id?: string;
  className?: string;
  footer?: ReactNode;
  sendLabel?: string;
}

export function ChatComposer({
  value, onChange, onSend, disabled = false, isSending = false,
  placeholder = '输入任务，Enter 发送，Shift + Enter 换行',
  'aria-label': ariaLabel = '任务内容', id, className = '', footer, sendLabel = '发送',
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [localSending, setLocalSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const ime = useComposerImeGuard();
  const busy = isSending || localSending;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Upstream RichComposer fallback works without CSS field-sizing support.
    el.style.height = 'auto';
    const maximum = Math.max(44, Math.min(384, window.innerHeight * 0.4));
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), maximum)}px`;
  }, [value]);

  const send = async () => {
    const content = value.trim();
    if (!content || disabled || busy || pending.current) return;
    pending.current = true;
    setLocalSending(true);
    setSendError(false);
    try {
      await onSend(content);
      // The host owns the draft; only it may clear after successful submission.
    } catch {
      if (mounted.current) setSendError(true);
    } finally {
      pending.current = false;
      if (mounted.current) setLocalSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ime.shouldIgnoreKeyDown(event)) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat) void send();
    }
  };

  return (
    <div className={`ael-cds-composer ${className}`.trim()} data-cds="Composer" aria-busy={busy}>
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(event) => { setSendError(false); onChange(event.target.value); }}
        onKeyDown={handleKeyDown}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        disabled={disabled || busy}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={1}
      />
      <div className="ael-cds-composer-toolbar">
        <div className="ael-cds-composer-footer">{footer}</div>
        <CdsButton
          variant="primary" size="sm" onClick={() => void send()}
          disabled={disabled || !value.trim()} isLoading={busy} aria-label={sendLabel}
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" /></svg>}
        >
          {sendLabel}
        </CdsButton>
      </div>
      {sendError && <p className="ael-cds-composer-error" role="alert">发送未完成，内容已保留，请重试。</p>}
    </div>
  );
}
