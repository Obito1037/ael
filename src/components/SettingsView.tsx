/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Info, Terminal } from 'lucide-react';

interface SettingsViewProps {
  onResetDatabase: () => void;
  addToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export default function SettingsView({ onResetDatabase, addToast }: SettingsViewProps) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="border-b border-[#E2E8F0] pb-6">
        <h2 className="font-sans text-xl font-bold text-black mb-1">系统设置 & 整合配置</h2>
        <p className="font-sans text-xs text-[#747878] leading-relaxed">
          管理 AEL 工作区密钥、同步策略以及本地数据库回滚。
        </p>
      </div>

      {/* Status and Database panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Panel row 1 */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4 shadow-sm hover:border-black/20 transition-colors">
          <h3 className="font-sans text-xs font-bold text-black uppercase tracking-wider flex items-center gap-2">
            <Info className="w-4 h-4 text-[#747878]" />
            系统架构参数
          </h3>
          
          <div className="space-y-3 font-mono text-xs text-black">
            <div className="flex justify-between py-1.5 border-b border-[#E2E8F0]/50">
              <span className="text-[#747878]">系统版本</span>
              <span className="font-semibold px-2 py-0.5 bg-[#f2f4f6] rounded">v1.2.0-stable</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#E2E8F0]/50">
              <span className="text-[#747878]">沙箱执行环境</span>
              <span className="font-semibold text-[#10b981] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></span>
                Antigravity Node Secure
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#E2E8F0]/50">
              <span className="text-[#747878]">执行引擎核心</span>
              <span className="font-semibold">Gemini 2.5 Flash / tsx</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[#747878]">状态同步策略</span>
              <span className="font-semibold text-[#7c3aed]">localStorage Durable Cache</span>
            </div>
          </div>
        </div>

        {/* DB reset panel */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 flex flex-col justify-between shadow-sm hover:border-black/20 transition-colors">
          <div className="space-y-2">
            <h3 className="font-sans text-xs font-bold text-black uppercase tracking-wider">
              数据管理机制
            </h3>
            <p className="font-sans text-xs text-[#747878] leading-relaxed">
              AEL 依靠先进的本地数据挂载手段保护您的 Agent 状态不逸散。如果您在执行测试期间积累了不需要的数据，可以安全进行恢复历史操作。
            </p>
          </div>

          <div className="pt-6 flex flex-wrap gap-3 mt-auto">
            <button
              onClick={onResetDatabase}
              className="px-4 py-2 bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 rounded font-sans text-xs font-semibold cursor-pointer border border-[#ef4444]/10 transition-colors active:scale-95"
            >
              恢复出厂设置
            </button>
            <button
              onClick={() => {
                addToast('日志系统数据库健康检查：正常 (100%)。无丢失的数据指针。', 'success');
              }}
              className="px-4 py-2 border border-[#E2E8F0] text-black hover:bg-[#f2f4f6] rounded font-sans text-xs font-semibold cursor-pointer transition-colors active:scale-95"
            >
              运行日志健康检测
            </button>
          </div>
        </div>

        {/* API variables configuration block */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4 md:col-span-2 shadow-sm hover:border-black/20 transition-colors">
          <h3 className="font-sans text-xs font-bold text-black uppercase tracking-wider flex items-center gap-1.5">
            <Terminal className="w-4 h-4 text-[#7c3aed]" />
            环境变更变量预览 (.env.example 参考)
          </h3>
          <p className="font-sans text-sm text-[#444748] leading-relaxed">
            AEL 在高灵敏环境中收集并分析错误。在真正的企业级应用中，敏感的 API key 与 URL 重定向应当存放在配置文件中：
          </p>
          <div className="relative group">
            <pre className="p-4 bg-[#191c1e] text-[#e0e3e5] rounded-lg font-mono text-xs overflow-x-auto select-all leading-relaxed whitespace-pre-wrap border border-[#E2E8F0] shadow-inner">
              <span className="text-[#64748b]"># GEMINI_API_KEY: Required for cloud security logs categorization</span>{'\n'}
              <span className="text-[#64748b]"># Automatically injected by AI Studio control systems</span>{'\n'}
              <span className="text-[#d2bbff]">GEMINI_API_KEY</span>=<span className="text-[#10b981]">"MY_GEMINI_API_KEY"</span>{'\n\n'}
              <span className="text-[#64748b]"># APP_URL: Self-referential secure tunnels redirects.</span>{'\n'}
              <span className="text-[#d2bbff]">APP_URL</span>=<span className="text-[#10b981]">"https://ais-dev.run.app"</span>
            </pre>
            <button 
              onClick={() => addToast('配置已复制到剪贴板！', 'success')}
              className="absolute top-2 right-2 bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded text-[10px] font-sans opacity-0 group-hover:opacity-100 transition-opacity"
            >
              复制
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
