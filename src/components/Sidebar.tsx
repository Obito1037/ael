/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClipboardList, Puzzle, ShieldAlert, Settings, FileText, HelpCircle } from 'lucide-react';

interface SidebarProps {
  currentTab: 'tasks' | 'skills' | 'failures' | 'settings';
  setCurrentTab: (tab: 'tasks' | 'skills' | 'failures' | 'settings') => void;
  addToast: (msg: string, type: 'info'|'success'|'warning'|'error') => void;
}

export default function Sidebar({ currentTab, setCurrentTab, addToast }: SidebarProps) {
  const menuItems = [
    { id: 'tasks', label: '任务', icon: ClipboardList },
    { id: 'skills', label: '技能', icon: Puzzle },
    { id: 'failures', label: '故障模式', icon: ShieldAlert },
    { id: 'settings', label: '设置', icon: Settings },
  ] as const;

  return (
    <aside className="fixed left-0 top-0 h-full w-[240px] bg-white border-r border-[#E2E8F0] flex flex-col py-6 z-40 hidden md:flex">
      {/* Brand Header */}
      <div className="px-6 mb-8 group cursor-pointer hover:opacity-80 transition-opacity">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-black text-white rounded flex items-center justify-center font-sans font-black text-lg shadow-sm">
            A
          </div>
          <div>
            <h2 className="font-sans text-xl font-bold text-black tracking-tight leading-none group-hover:text-[#7c3aed] transition-colors">AEL</h2>
            <p className="font-mono text-[11px] text-[#747878] mt-1">v1.2.0-stable</p>
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 flex flex-col gap-1 px-3">
        {menuItems.map((item) => {
          const IconComponent = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded transition-all duration-150 text-left ${
                isActive
                  ? 'text-black font-semibold bg-[#eceef0] border-l-2 border-black rounded-l-none pl-[14px]'
                  : 'text-[#444748] hover:bg-[#f2f4f6]'
              }`}
            >
              <IconComponent className={`w-5 h-5 ${isActive ? 'text-black' : 'text-[#747878]'}`} />
              <span className="font-sans text-sm">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer Resources */}
      <div className="mt-auto px-3 pt-4 border-t border-[#E2E8F0] mx-3 space-y-1">
        <a
          href="#docs"
          onClick={(e) => { 
            e.preventDefault(); 
            addToast('文档组件加载成功。您可以在此浏览 AEL SDK、执行规范以及多 Agent 机能拓扑。', 'info'); 
          }}
          className="flex items-center gap-3 px-4 py-2 text-[#444748] hover:bg-[#f2f4f6] rounded transition-colors group"
        >
          <FileText className="w-5 h-5 text-[#747878] group-hover:text-black transition-colors" />
          <span className="font-sans text-sm group-hover:text-black transition-colors">文档</span>
        </a>
        <a
          href="#support"
          onClick={(e) => { 
            e.preventDefault(); 
            addToast('已尝试建立在线支持通讯卫星链接。由于无人工在线，连接超时。', 'warning'); 
          }}
          className="flex items-center gap-3 px-4 py-2 text-[#444748] hover:bg-[#f2f4f6] rounded transition-colors group"
        >
          <HelpCircle className="w-5 h-5 text-[#747878] group-hover:text-black transition-colors" />
          <span className="font-sans text-sm group-hover:text-black transition-colors">支持</span>
        </a>
      </div>
    </aside>
  );
}
