import type { TerminalChunk } from "../types";

// One bounded snapshot + one bounded live buffer, including ANSI formatting.
const MAX_QUEUED_CHARS = 2 * 1_048_576 + 131_072;
const MAX_QUEUED_CHUNKS = 4_096;
const MAX_BATCH_CHARS = 65_536;

/** Snapshot rows are ordered by seq in the backend. Sort only the bounded live buffer. */
export function replayTerminalChunks(
  snapshot: readonly TerminalChunk[],
  buffered: TerminalChunk[],
  sessionId: string,
  consume: (chunk: TerminalChunk) => void,
) {
  buffered.sort((left, right) => left.seq - right.seq);
  let snapshotIndex = 0;
  let bufferedIndex = 0;
  let lastSeq = -1;
  while (snapshotIndex < snapshot.length || bufferedIndex < buffered.length) {
    const fromSnapshot = snapshotIndex < snapshot.length && (
      bufferedIndex >= buffered.length || snapshot[snapshotIndex].seq <= buffered[bufferedIndex].seq
    );
    const chunk = fromSnapshot ? snapshot[snapshotIndex++] : buffered[bufferedIndex++];
    if (chunk.sessionId !== sessionId || chunk.seq <= lastSeq) continue;
    consume(chunk);
    lastSeq = chunk.seq;
  }
}

/** Keep xterm's asynchronous parser queue bounded, including during snapshot replay. */
export class TerminalWriter {
  private queue: string[] = [];
  private queuedChars = 0;
  private dropped = 0;
  private frame: number | null = null;
  private writing = false;
  private resetPending = false;
  private disposed = false;

  constructor(
    private readonly write: (text: string, done: () => void) => void,
    private readonly resetTerminal: () => void,
  ) {}

  enqueue(text: string) {
    if (this.disposed || !text) return;
    if (this.queue.length >= MAX_QUEUED_CHUNKS || this.queuedChars + text.length > MAX_QUEUED_CHARS) {
      this.dropped += 1;
    } else {
      this.queue.push(text);
      this.queuedChars += text.length;
    }
    this.schedule();
  }

  reset() {
    if (this.disposed) return;
    this.queue = [];
    this.queuedChars = 0;
    this.dropped = 0;
    this.resetPending = true;
    this.schedule();
  }

  dispose() {
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.queue = [];
    this.queuedChars = 0;
    this.dropped = 0;
  }

  private schedule() {
    if (this.disposed || this.writing || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.flush();
    });
  }

  private flush() {
    if (this.disposed || this.writing) return;
    // An old write may still be parsing: reset only after its callback has completed.
    if (this.resetPending) {
      this.resetPending = false;
      this.resetTerminal();
    }
    let batch = "";
    if (this.dropped > 0) {
      batch = `\r\n\x1b[38;5;208m[AEL] 显示队列已满，折叠 ${this.dropped} 个输出块；完整记录保留在会话中。\x1b[0m\r\n`;
      this.dropped = 0;
    }
    while (this.queue.length && batch.length < MAX_BATCH_CHARS) {
      const next = this.queue[0];
      const count = Math.min(next.length, MAX_BATCH_CHARS - batch.length);
      batch += next.slice(0, count);
      this.queuedChars -= count;
      if (count === next.length) this.queue.shift();
      else this.queue[0] = next.slice(count);
    }
    if (!batch) return;
    this.writing = true;
    this.write(batch, () => {
      this.writing = false;
      if (!this.disposed && (this.queue.length || this.dropped || this.resetPending)) this.schedule();
    });
  }
}
