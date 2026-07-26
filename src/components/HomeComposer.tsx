import { useState, useEffect } from 'react';
import { AgentProfile, Task } from '../types';
import { ipc } from '../lib/ipc';
import { Folder, GitBranch, Mic, Bot } from 'lucide-react';

interface HomeComposerProps {
  tasks: Task[];
  onLaunch: (sessionId: string) => void;
  addToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export default function HomeComposer({ tasks, onLaunch, addToast }: HomeComposerProps) {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [cwd, setCwd] = useState('D:/desktop/my-repo');
  const [prompt, setPrompt] = useState('');
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    ipc.detect_agents().then(res => {
      setProfiles(res);
      if (res.length > 0) setSelectedProfileId(res[0].id);
    });
    if (tasks.length > 0) setSelectedTaskId(tasks[0].id);
  }, [tasks]);

  const handleLaunch = async () => {
    try {
      setLaunching(true);
      const locks = await ipc.list_workspace_locks();
      if (locks.some(l => l.repoPath === cwd)) {
         addToast('工作区被占用', 'warning');
         // We might just bypass or show error.
      }
      
      const ctx = await ipc.build_agent_startup_context({
        taskId: selectedTaskId,
        agentKind: 'codex', // Hardcode or lookup from profile
        profileId: selectedProfileId
      });
      const finalPrompt = `${ctx}\n\nUSER PROMPT: ${prompt}`;
      
      const session = await ipc.start_agent_session({
        taskId: selectedTaskId,
        profileId: selectedProfileId,
        cwd,
        initialPrompt: finalPrompt,
        lockWorkspace: true,
        autoIngest: true
      });
      addToast('Session 启动成功！', 'success');
      onLaunch(session.id);
    } catch (e) {
      addToast('启动失败', 'error');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[calc(100vh-120px)] gap-8 animate-fade-in">
       <div className="text-center mb-2">
         <h2 className="text-[28px] font-bold text-black tracking-tight mb-2">选择一个文件夹，启动一个 Agent</h2>
         <p className="text-[#64748b] text-sm">极简多 Agent 驱动与会话工作流引擎</p>
       </div>

       {/* Composer Card */}
       <div className="w-full bg-white rounded-[20px] shadow-[0_4px_30px_rgb(0,0,0,0.04)] border border-[#E2E8F0] flex flex-col overflow-hidden transition-all focus-within:ring-2 focus-within:ring-black/5 focus-within:border-[#c4c7c7]">
          {/* Top: Folder Selector */}
          <div className="px-6 py-4 border-b border-[#f1f5f9] flex items-center gap-3 bg-white">
             <div className="w-8 h-8 rounded-lg bg-[#f8fafc] border border-[#E2E8F0] flex items-center justify-center shrink-0">
               <Folder className="w-4 h-4 text-black" />
             </div>
             <input 
               className="flex-1 text-sm font-bold outline-none text-black placeholder:text-[#94a3b8] bg-transparent" 
               value={cwd}
               onChange={e => setCwd(e.target.value)}
               placeholder="输入完整工作区路径 (或调用系统对话框)"
             />
             <div className="w-px h-4 bg-[#E2E8F0] hidden sm:block"></div>
             <select 
               className="text-xs font-semibold text-[#64748b] bg-transparent outline-none cursor-pointer hover:text-black"
               value={selectedTaskId}
               onChange={e => setSelectedTaskId(e.target.value)}
             >
               <option value="">+ 绑定已有任务(可选)</option>
               {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
             </select>
          </div>

          {/* Middle: Text Area */}
          <div className="p-6">
            <textarea
              className="w-full h-32 outline-none text-[17px] text-black resize-none placeholder:text-[#cbd5e1] font-sans leading-relaxed"
              placeholder="描述目标, @ 提任务, / 触发动作..."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
          </div>

          {/* Bottom: Tools & Launch */}
          <div className="px-6 py-4 border-t border-[#f1f5f9] flex items-center justify-between bg-[#fcfcff]">
            <div className="flex items-center gap-5">
               {/* Agent Selector */}
               <div className="flex items-center gap-2 group cursor-pointer hover:opacity-80">
                 <Bot className="w-4 h-4 text-[#7c3aed]" />
                 <select 
                   className="text-sm font-bold text-black bg-transparent outline-none cursor-pointer"
                   value={selectedProfileId}
                   onChange={e => setSelectedProfileId(e.target.value)}
                 >
                   {profiles.map(p => (
                     <option key={p.id} value={p.id}>{p.displayName} {p.capabilities?.includes('MCP') ? '(MCP)' : ''}</option>
                   ))}
                 </select>
               </div>

               <div className="w-px h-4 bg-[#E2E8F0]"></div>

               {/* Branch Mode */}
               <div className="flex items-center gap-2 group cursor-pointer hover:opacity-80">
                 <GitBranch className="w-4 h-4 text-black" />
                 <select className="text-sm font-semibold text-black bg-transparent outline-none cursor-pointer">
                   <option>Local</option>
                   <option disabled>New Worktree</option>
                 </select>
               </div>
            </div>

            <div className="flex items-center gap-3">
               <button className="w-10 h-10 rounded-full border border-[#E2E8F0] flex items-center justify-center text-[#64748b] hover:text-black hover:bg-white transition-all bg-[#f8fafc] hover:shadow-sm">
                 <Mic className="w-4 h-4" />
               </button>
               <button 
                 onClick={handleLaunch}
                 disabled={launching || !prompt.trim()}
                 className="px-8 py-2.5 bg-black text-white rounded-full font-bold text-sm hover:opacity-80 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md hover:shadow-lg flex items-center gap-2"
               >
                 {launching ? '启动中...' : '启动 Agent'}
               </button>
            </div>
          </div>
       </div>
    </div>
  );
}
