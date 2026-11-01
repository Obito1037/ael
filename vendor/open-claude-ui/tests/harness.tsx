import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatComposer, CdsButton, useClaudeScrollPinning } from '../src';
import '../styles/cds-pure.css';
import '../styles/components.css';

function Harness() {
  const [value, setValue] = useState('');
  const [sends, setSends] = useState(0);
  const [mode, setMode] = useState('success');
  const [disabled, setDisabled] = useState(false);
  const [rows, setRows] = useState(30);
  const scroll = useClaudeScrollPinning([rows]);
  return <main style={{ width: 700, margin: 20 }}>
    <ChatComposer value={value} onChange={setValue} disabled={disabled} onSend={async () => {
      setSends((count) => count + 1);
      if (mode === 'failure') throw new Error('Test send failure');
      if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 250));
      setValue('');
    }} />
    <output data-testid="sends">{sends}</output>
    <select aria-label="提交模式" value={mode} onChange={(e) => setMode(e.target.value)}>
      <option value="success">success</option><option value="failure">failure</option><option value="slow">slow</option>
    </select>
    <button onClick={() => setDisabled(!disabled)}>切换禁用</button>
    <CdsButton name="append" onClick={() => setRows((count) => count + 1)}>追加</CdsButton>
    <div data-testid="stream" ref={scroll.containerRef} onScroll={scroll.handleScroll}
      onWheel={scroll.markUserInput} onTouchMove={scroll.markUserInput}
      style={{ overflowY: 'auto', height: 160, marginTop: 20 }}>
      {Array.from({ length: rows }, (_, index) => <div key={index} style={{ height: 30 }}>Row {index}</div>)}
    </div>
    {scroll.showJumpControl && <button onClick={() => scroll.scrollToBottom()}>回到底部</button>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
