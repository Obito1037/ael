import { useState, useEffect } from 'react';
import { AgentConfigTarget, AgentConfigContent, ProviderConfig, MCPServerConfig } from '../types';
import { ipc } from '../lib/ipc';
import { Save, RefreshCw, Archive, FileCode2, Terminal, HardDrive, Key, Server, Plus, Activity } from 'lucide-react';

interface AgentConfigsProps {
  addToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

function RawConfigsViewer({ addToast }: AgentConfigsProps) {
  const [targets, setTargets] = useState<AgentConfigTarget[]>([]);
  const [activeTarget, setActiveTarget] = useState<AgentConfigTarget | null>(null);
  const [content, setContent] = useState<AgentConfigContent | null>(null);
  const [editedText, setEditedText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadTargets();
  }, []);

  const loadTargets = async () => {
    try {
      const data = await ipc.list_agent_config_targets();
      setTargets(data);
      if (data.length > 0 && !activeTarget) {
        handleSelectTarget(data[0]);
      }
    } catch (err: any) {
      addToast(`加载配置列表失败: ${err.message}`, 'error');
    }
  };

  const handleSelectTarget = async (target: AgentConfigTarget) => {
    setActiveTarget(target);
    setIsLoading(true);
    try {
      const data = await ipc.read_agent_config_target({ targetId: target.id });
      setContent(data);
      setEditedText(data.content);
    } catch (err: any) {
      addToast(`读取配置失败: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!activeTarget) return;
    try {
      await ipc.write_agent_config_target({ targetId: activeTarget.id, content: editedText });
      addToast(`[${activeTarget.name}] 保存成功！`, 'success');
      const data = await ipc.read_agent_config_target({ targetId: activeTarget.id });
      setContent(data);
      setEditedText(data.content);
    } catch (err: any) {
      addToast(`保存失败: ${err.message}`, 'error');
    }
  };

  const handleBackup = async () => {
    if (!activeTarget) return;
    try {
      const res = await ipc.backup_agent_config_target({ targetId: activeTarget.id });
      addToast(`已备份至: ${res.backupPath}`, 'info');
    } catch (err: any) {
      addToast(`备份失败: ${err.message}`, 'error');
    }
  };

  return (
    <div className="flex h-full gap-6">
      <div className="w-64 flex flex-col gap-4 overflow-y-auto pr-2">
        {Array.from(new Set(targets.map(t => t.agentKind || 'general'))).map(agentKind => (
          <div key={agentKind} className="flex flex-col gap-2">
            <div className="text-xs font-bold text-[#94a3b8] uppercase mb-1">{agentKind} 专属配置</div>
            {targets.filter(t => (t.agentKind || 'general') === agentKind).map(target => (
              <button
                key={target.id}
                onClick={() => handleSelectTarget(target)}
                className={`p-3 text-left rounded-xl transition-all border ${
                  activeTarget?.id === target.id
                    ? 'bg-white border-[#7c3aed] shadow-sm'
                    : 'bg-transparent border-transparent hover:bg-white hover:border-[#f1f5f9]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {target.type === 'global' ? (
                    <Terminal className={`w-4 h-4 ${activeTarget?.id === target.id ? 'text-[#7c3aed]' : 'text-[#64748b]'}`} />
                  ) : (
                    <HardDrive className={`w-4 h-4 ${activeTarget?.id === target.id ? 'text-[#7c3aed]' : 'text-[#64748b]'}`} />
                  )}
                  <span className={`text-sm font-bold ${activeTarget?.id === target.id ? 'text-[#7c3aed]' : 'text-black'}`}>
                    {target.name}
                  </span>
                </div>
                <p className="text-[10px] text-[#94a3b8] truncate">{target.path}</p>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex-1 bg-white border border-[#f1f5f9] rounded-2xl shadow-sm flex flex-col overflow-hidden">
        {activeTarget ? (
          <>
            <div className="p-4 border-b border-[#f1f5f9] flex items-center justify-between bg-[#faf5ff]/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#faf5ff] text-[#7c3aed] flex items-center justify-center border border-[#e9d5ff]">
                  <FileCode2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-sans font-bold text-black flex items-center gap-2">
                    {activeTarget.name}
                    <span className="px-2 py-0.5 bg-[#f8fafc] border border-[#f1f5f9] text-[#64748b] rounded-md text-[10px] font-mono">
                      {activeTarget.agentKind}
                    </span>
                  </h3>
                  <p className="text-xs text-[#64748b]">{activeTarget.description}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBackup}
                  className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#64748b] hover:text-black border border-[#f1f5f9] rounded-lg hover:bg-[#f8fafc] transition-colors"
                >
                  <Archive className="w-3.5 h-3.5" /> 备份
                </button>
                <button
                  onClick={() => handleSelectTarget(activeTarget)}
                  className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#64748b] hover:text-black border border-[#f1f5f9] rounded-lg hover:bg-[#f8fafc] transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> 刷新
                </button>
                <button
                  onClick={handleSave}
                  title="保存并自动生成历史备份"
                  className="px-4 py-1.5 flex items-center gap-1.5 text-xs font-semibold bg-[#7c3aed] hover:bg-[#6d28d9] text-white rounded-lg transition-colors shadow-sm"
                >
                  <Save className="w-3.5 h-3.5" /> 保存配置 (自动备份)
                </button>
              </div>
            </div>

            <div className="flex-1 relative bg-[#0f172a] p-4">
              {isLoading ? (
                <div className="text-[#64748b] text-sm flex items-center justify-center h-full">加载中...</div>
              ) : (
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  className="w-full h-full bg-transparent text-[#e2e8f0] font-mono text-sm resize-none focus:outline-none leading-relaxed"
                  spellCheck="false"
                />
              )}
            </div>
            <div className="bg-[#1e293b] px-4 py-1 flex items-center justify-between border-t border-black/20">
              <span className="text-[#94a3b8] font-mono text-[10px]">Path: {activeTarget.path}</span>
              <span className="text-[#94a3b8] font-mono text-[10px]">Format: {content?.format?.toUpperCase()}</span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#94a3b8] text-sm">
            请从左侧选择一个配置项以编辑
          </div>
        )}
      </div>
    </div>
  );
}

function ProvidersViewer({ addToast }: AgentConfigsProps) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [activeProv, setActiveProv] = useState<ProviderConfig | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      const data = await ipc.list_providers();
      setProviders(data);
      if (data.length > 0 && !activeProv) {
        setActiveProv(data[0]);
      }
    } catch (err: any) {
      addToast(`加载 Providers 失败: ${err.message}`, 'error');
    }
  };

  const handleTest = async () => {
    if (!activeProv) return;
    try {
      addToast('正在测试连通性...', 'info');
      const res = await ipc.test_provider({ providerId: activeProv.id });
      if (res.success) {
        addToast(res.message, 'success');
      } else {
        addToast(res.message, 'error');
      }
    } catch (err: any) {
      addToast(`测试失败: ${err.message}`, 'error');
    }
  };

  const handleSave = async () => {
    if (!activeProv) return;
    try {
      await ipc.save_provider({ provider: activeProv });
      addToast('Provider 保存成功！', 'success');
      load();
    } catch (err: any) {
      addToast(`保存失败: ${err.message}`, 'error');
    }
  };

  return (
    <div className="flex h-full gap-6">
      <div className="w-64 flex flex-col gap-4 overflow-y-auto pr-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-[#94a3b8] uppercase">已配置 Provider</div>
          <button className="text-[#7c3aed] hover:bg-[#7c3aed]/10 p-1 rounded transition-colors" title="新增 Provider">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {providers.map(prov => (
          <button
            key={prov.id}
            onClick={() => setActiveProv(prov)}
            className={`p-3 text-left rounded-xl transition-all border ${
              activeProv?.id === prov.id
                ? 'bg-white border-[#7c3aed] shadow-sm'
                : 'bg-transparent border-transparent hover:bg-white hover:border-[#f1f5f9]'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-sm font-bold ${activeProv?.id === prov.id ? 'text-[#7c3aed]' : 'text-black'}`}>
                {prov.name}
              </span>
              <span className={`w-2 h-2 rounded-full ${prov.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
            </div>
            <p className="text-[10px] text-[#94a3b8] uppercase flex items-center gap-1">
              <Key className="w-3 h-3" /> {prov.targetApp}
            </p>
          </button>
        ))}
      </div>

      <div className="flex-1 bg-white border border-[#f1f5f9] rounded-2xl shadow-sm flex flex-col p-6 overflow-y-auto">
        {activeProv ? (
          <div className="max-w-2xl w-full space-y-6">
            <div className="flex items-center justify-between border-b border-[#f1f5f9] pb-4">
              <h2 className="font-sans text-xl font-bold text-black flex items-center gap-2">
                <Key className="w-5 h-5 text-[#7c3aed]" />
                编辑 Provider
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={handleTest}
                  className="px-4 py-1.5 flex items-center gap-1.5 text-xs font-semibold border border-[#E2E8F0] text-black rounded hover:bg-[#f8fafc] transition-colors"
                >
                  <Activity className="w-3.5 h-3.5" /> 测试连通性
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-1.5 flex items-center gap-1.5 text-xs font-semibold bg-[#0f172a] hover:bg-black text-white rounded transition-colors"
                >
                  <Save className="w-3.5 h-3.5" /> 保存
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-bold text-[#64748b] mb-1 block">配置名称</span>
                <input 
                  type="text" 
                  value={activeProv.name} 
                  onChange={e => setActiveProv({...activeProv, name: e.target.value})}
                  className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:border-[#7c3aed] focus:ring-1 focus:ring-[#7c3aed] outline-none" 
                />
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-bold text-[#64748b] mb-1 block">目标应用 (Target App)</span>
                  <select 
                    value={activeProv.targetApp}
                    onChange={e => setActiveProv({...activeProv, targetApp: e.target.value as any})}
                    className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white focus:border-[#7c3aed] outline-none"
                  >
                    <option value="universal">通用 (Universal)</option>
                    <option value="claude">Claude</option>
                    <option value="codex">Codex</option>
                    <option value="gemini">Gemini</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-[#64748b] mb-1 block">绑定模型 (Model)</span>
                  <input 
                    type="text" 
                    value={activeProv.model} 
                    onChange={e => setActiveProv({...activeProv, model: e.target.value})}
                    className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:border-[#7c3aed] outline-none" 
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-bold text-[#64748b] mb-1 block">API Endpoint</span>
                <input 
                  type="text" 
                  value={activeProv.endpoint} 
                  onChange={e => setActiveProv({...activeProv, endpoint: e.target.value})}
                  className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm font-mono focus:border-[#7c3aed] outline-none" 
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold text-[#64748b] mb-1 flex justify-between">
                  API Key
                  <span className="text-[10px] text-[#94a3b8] font-normal">脱敏显示，系统不会明文传输</span>
                </span>
                <input 
                  type="password" 
                  value={activeProv.apiKey} 
                  onChange={e => setActiveProv({...activeProv, apiKey: e.target.value})}
                  className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm font-mono focus:border-[#7c3aed] outline-none" 
                  placeholder="sk-..."
                />
              </label>

              <label className="flex items-center gap-2 mt-2">
                <input 
                  type="checkbox" 
                  checked={activeProv.isActive}
                  onChange={e => setActiveProv({...activeProv, isActive: e.target.checked})}
                  className="rounded text-[#7c3aed] focus:ring-[#7c3aed]"
                />
                <span className="text-sm font-bold text-black">设为活跃 (Active)</span>
              </label>

              <div className="bg-[#f8fafc] rounded-lg p-4 border border-[#f1f5f9] mt-6">
                <p className="text-xs text-[#64748b] leading-relaxed">
                  <strong>提示：</strong> 激活 Provider 会将对应的 API Key 和 Endpoint 注入到运行环境的环境变量中（例如 OPENAI_API_KEY，ANTHROPIC_API_KEY），这会覆盖 CLI 的默认配置。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#94a3b8] text-sm">
            请选择左侧的 Provider
          </div>
        )}
      </div>
    </div>
  );
}

function MCPServersViewer({ addToast }: AgentConfigsProps) {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [activeSrv, setActiveSrv] = useState<MCPServerConfig | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      const data = await ipc.list_mcp_servers();
      setServers(data);
      if (data.length > 0 && !activeSrv) {
        setActiveSrv(data[0]);
      }
    } catch (err: any) {
      addToast(`加载 MCP 失败: ${err.message}`, 'error');
    }
  };

  const handleSave = async () => {
    if (!activeSrv) return;
    try {
      await ipc.save_mcp_server({ server: activeSrv });
      addToast('MCP Server 保存成功！', 'success');
      load();
    } catch (err: any) {
      addToast(`保存失败: ${err.message}`, 'error');
    }
  };

  return (
    <div className="flex h-full gap-6">
      <div className="w-64 flex flex-col gap-4 overflow-y-auto pr-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-[#94a3b8] uppercase">已配置 MCP Servers</div>
          <button className="text-[#7c3aed] hover:bg-[#7c3aed]/10 p-1 rounded transition-colors" title="新增 MCP Server">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {servers.map(srv => (
          <button
            key={srv.id}
            onClick={() => setActiveSrv(srv)}
            className={`p-3 text-left rounded-xl transition-all border ${
              activeSrv?.id === srv.id
                ? 'bg-white border-[#7c3aed] shadow-sm'
                : 'bg-transparent border-transparent hover:bg-white hover:border-[#f1f5f9]'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-sm font-bold ${activeSrv?.id === srv.id ? 'text-[#7c3aed]' : 'text-black'}`}>
                {srv.name}
              </span>
              <span className={`w-2 h-2 rounded-full ${srv.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
            </div>
            <p className="text-[10px] text-[#94a3b8] font-mono truncate">
              {srv.command} {srv.args.join(' ')}
            </p>
          </button>
        ))}
      </div>

      <div className="flex-1 bg-white border border-[#f1f5f9] rounded-2xl shadow-sm flex flex-col p-6 overflow-y-auto">
        {activeSrv ? (
          <div className="max-w-2xl w-full space-y-6">
            <div className="flex items-center justify-between border-b border-[#f1f5f9] pb-4">
              <h2 className="font-sans text-xl font-bold text-black flex items-center gap-2">
                <Server className="w-5 h-5 text-[#7c3aed]" />
                编辑 MCP Server
              </h2>
              <button
                onClick={handleSave}
                className="px-4 py-1.5 flex items-center gap-1.5 text-xs font-semibold bg-[#0f172a] hover:bg-black text-white rounded transition-colors"
              >
                <Save className="w-3.5 h-3.5" /> 保存配置
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-bold text-[#64748b] mb-1 block">服务器名称</span>
                <input 
                  type="text" 
                  value={activeSrv.name} 
                  onChange={e => setActiveSrv({...activeSrv, name: e.target.value})}
                  className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:border-[#7c3aed] outline-none" 
                />
              </label>

              <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-4">
                <label className="block">
                  <span className="text-xs font-bold text-[#64748b] mb-1 block">执行命令</span>
                  <input 
                    type="text" 
                    value={activeSrv.command} 
                    onChange={e => setActiveSrv({...activeSrv, command: e.target.value})}
                    className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm font-mono focus:border-[#7c3aed] outline-none" 
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-[#64748b] mb-1 block">运行参数 (Args)</span>
                  <input 
                    type="text" 
                    value={activeSrv.args.join(' ')} 
                    onChange={e => setActiveSrv({...activeSrv, args: e.target.value.split(' ')})}
                    className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm font-mono focus:border-[#7c3aed] outline-none" 
                  />
                </label>
              </div>

              <div className="block pt-2">
                <span className="text-xs font-bold text-[#64748b] mb-2 flex items-center gap-2">
                  环境变量注入 (Env Variables)
                </span>
                <div className="bg-[#f8fafc] border border-[#f1f5f9] rounded-lg p-3 space-y-2">
                  {Object.entries(activeSrv.env).map(([key, val]) => (
                    <div key={key} className="flex gap-2">
                      <input 
                        value={key} readOnly 
                        className="w-1/3 bg-transparent text-sm font-mono text-black outline-none border-b border-dashed border-[#cbd5e1] pb-1" 
                      />
                      <input 
                        value={val} readOnly 
                        type="password"
                        className="flex-1 bg-transparent text-sm font-mono text-[#64748b] outline-none border-b border-dashed border-[#cbd5e1] pb-1" 
                      />
                    </div>
                  ))}
                  {Object.keys(activeSrv.env).length === 0 && (
                    <div className="text-xs text-[#94a3b8] italic">无需环境变量。</div>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 mt-4">
                <input 
                  type="checkbox" 
                  checked={activeSrv.isActive}
                  onChange={e => setActiveSrv({...activeSrv, isActive: e.target.checked})}
                  className="rounded text-[#7c3aed] focus:ring-[#7c3aed]"
                />
                <span className="text-sm font-bold text-black">全局激活 (Active)</span>
              </label>

              <div className="bg-[#faf5ff] rounded-lg p-4 border border-[#e9d5ff] mt-6">
                <p className="text-xs text-[#7c3aed] leading-relaxed">
                  <strong>统一分发：</strong> 激活的 MCP Server 将在 Codex 和 Claude 启动时自动注入其配置文件，实现跨 Agent 的全局可用。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#94a3b8] text-sm">
            请选择左侧的 MCP Server
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentConfigs({ addToast }: AgentConfigsProps) {
  const [tab, setTab] = useState<'providers' | 'mcp' | 'raw'>('providers');

  return (
    <div className="flex flex-col h-full space-y-6 animate-fade-in">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 border-b border-[#E2E8F0] pb-6">
        <div>
          <h2 className="font-sans text-xl font-bold text-black mb-1">Agent 配置与能力 (CC Switch)</h2>
          <p className="font-sans text-xs text-[#747878] max-w-3xl leading-relaxed">
            统一管理大模型供应商密钥、网络连通性测试、MCP 外部工具服务器以及底层 Agent 原始配置文件。
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button 
          onClick={() => setTab('providers')} 
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${tab === 'providers' ? 'bg-[#0f172a] text-white' : 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]'}`}
        >
          Providers 密钥配置
        </button>
        <button 
          onClick={() => setTab('mcp')} 
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${tab === 'mcp' ? 'bg-[#0f172a] text-white' : 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]'}`}
        >
          MCP Servers (工具库)
        </button>
        <button 
          onClick={() => setTab('raw')} 
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${tab === 'raw' ? 'bg-[#0f172a] text-white' : 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]'}`}
        >
          原始配置文件 (Raw Files)
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'providers' && <ProvidersViewer addToast={addToast} />}
        {tab === 'mcp' && <MCPServersViewer addToast={addToast} />}
        {tab === 'raw' && <RawConfigsViewer addToast={addToast} />}
      </div>
    </div>
  );
}
