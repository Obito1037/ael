/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Bell, History, RotateCw, Download, Menu, Check } from 'lucide-react';

interface HeaderProps {
  currentTab: 'tasks' | 'skills' | 'failures' | 'settings';
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  statusFilter: string;
  setStatusFilter: (filter: string) => void;
  onRefresh: () => void;
  onExportHandover: () => void;
  onOpenMobileMenu?: () => void;
  addToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export default function Header({
  currentTab,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  onRefresh,
  onExportHandover,
  onOpenMobileMenu,
  addToast
}: HeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  
  const notifRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getPlaceholder = () => {
    switch (currentTab) {
      case 'tasks':
        return '搜索任务...';
      case 'skills':
        return '搜索技能...';
      case 'failures':
        return '搜索故障日志...';
      default:
        return '搜索...';
    }
  };

  const getFilterOptions = () => {
    switch (currentTab) {
      case 'tasks':
        return ['全部状态', '进行中', '阻塞', '待处理', '已验证'];
      case 'skills':
        return ['全部状态', '活跃', '草稿', '已弃用'];
      case 'failures':
        return ['全部状态', '防御激活', '警报已配置', '被动记录'];
      default:
        return [];
    }
  };

  const filterOptions = getFilterOptions();

  return (
    <header className="fixed top-0 right-0 left-0 md:left-[240px] h-16 bg-white/90 backdrop-blur-md border-b border-[#E2E8F0] flex justify-between items-center px-6 z-30 shadow-xs">
      {/* Search and Filter */}
      <div className="flex items-center gap-4 flex-1">
        {/* Mobile menu trigger */}
        <button 
          onClick={onOpenMobileMenu}
          className="md:hidden p-2 hover:bg-[#f2f4f6] rounded"
        >
          <Menu className="w-5 h-5 text-black" />
        </button>

        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#747878] w-[18px] h-[18px]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#f2f4f6] border border-[#E2E8F0] rounded-md pl-9 pr-3 py-2 font-sans text-sm focus:outline-none focus:border-black focus:bg-white focus:ring-1 focus:ring-black transition-all text-black"
            placeholder={getPlaceholder()}
          />
        </div>

        {filterOptions.length > 0 && (
          <div className="relative hidden sm:block">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="px-3 py-2 rounded-md border border-[#E2E8F0] font-sans text-xs font-semibold text-black bg-white hover:bg-[#f2f4f6] transition-colors flex items-center gap-2"
            >
              状态: {statusFilter}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 mt-1.5 w-40 bg-white border border-[#E2E8F0] rounded-md shadow-[0_4px_20px_rgb(0,0,0,0.1)] z-50 py-1 overflow-hidden">
                {filterOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setStatusFilter(opt);
                      setDropdownOpen(false);
                      addToast(`已过滤状态：${opt}`, 'info');
                    }}
                    className="w-full text-left px-4 py-2 font-sans text-xs hover:bg-[#f2f4f6] text-black transition-all flex items-center justify-between"
                  >
                    <span>{opt}</span>
                    {statusFilter === opt && <Check className="w-3.5 h-3.5 text-black" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Auxiliary Utilities */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Notifications Dropdown */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative text-[#747878] hover:text-black transition-colors w-8 h-8 rounded-full hover:bg-[#f2f4f6] flex items-center justify-center cursor-pointer active:scale-95"
          >
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[#ef4444] rounded-full ring-2 ring-white"></span>
          </button>
          
          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-[#E2E8F0] rounded-lg shadow-xl z-50 animate-fade-in overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E2E8F0] flex justify-between items-center bg-[#f7f9fb]">
                <h4 className="font-sans font-bold text-sm text-black">系统通知</h4>
                <span className="bg-[#ef4444]/10 text-[#ef4444] text-[10px] font-bold px-2 py-0.5 rounded-full">1 New</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                <div className="p-4 border-b border-[#E2E8F0] hover:bg-[#f9fafa] cursor-pointer">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#3b82f6] mt-1.5 shrink-0"></div>
                    <div>
                      <p className="font-sans text-sm text-black font-medium mb-0.5">防御策略已更新</p>
                      <p className="font-sans text-xs text-[#747878] leading-relaxed">Agent-Alpha 自动微调了 "输出模式不匹配" 的拦截阀值。</p>
                      <span className="font-mono text-[10px] text-[#a0a4a4] mt-1 block">2 mins ago</span>
                    </div>
                  </div>
                </div>
                <div className="p-4 hover:bg-[#f9fafa] cursor-pointer opacity-70">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-transparent border border-[#c4c7c7] mt-1.5 shrink-0"></div>
                    <div>
                      <p className="font-sans text-sm text-black font-medium mb-0.5">安全审计完成</p>
                      <p className="font-sans text-xs text-[#747878] leading-relaxed">系统目前处于正常状态，未发现计划外的安全中断。</p>
                      <span className="font-mono text-[10px] text-[#a0a4a4] mt-1 block">1 hour ago</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-2 border-t border-[#E2E8F0] bg-[#f7f9fb]">
                <button 
                  onClick={() => {
                    setNotifOpen(false);
                    addToast('所有通知已标记为已读', 'success');
                  }}
                  className="w-full text-center py-2 text-xs font-semibold text-[#444748] hover:text-black transition-colors"
                >
                  标记全部已读
                </button>
              </div>
            </div>
          )}
        </div>

        {/* History Dropdown */}
        <div className="relative" ref={historyRef}>
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="text-[#747878] hover:text-black transition-colors w-8 h-8 rounded-full hover:bg-[#f2f4f6] flex items-center justify-center cursor-pointer active:scale-95"
          >
            <History className="w-5 h-5" />
          </button>
          
          {historyOpen && (
            <div className="absolute right-0 mt-2 w-72 bg-white border border-[#E2E8F0] rounded-lg shadow-xl z-50 animate-fade-in overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#f7f9fb]">
                <h4 className="font-sans font-bold text-sm text-black">操作历史 (Session)</h4>
              </div>
              <div className="p-6 text-center">
                <History className="w-8 h-8 text-[#E2E8F0] mx-auto mb-2" />
                <p className="font-sans text-xs text-[#747878]">当前会话暂无关键操作审计历史。</p>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-[#E2E8F0] hidden sm:block"></div>

        <button
          onClick={onRefresh}
          className="px-4 py-2 border border-[#E2E8F0] rounded-md font-sans text-xs font-semibold text-black bg-white hover:bg-[#f2f4f6] hover:border-[#c4c7c7] transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-sm hidden md:flex"
        >
          <RotateCw className="w-3.5 h-3.5 text-[#747878]" />
          刷新
        </button>

        <button
          onClick={onExportHandover}
          className="px-4 py-2 bg-black text-white rounded-md font-sans text-xs font-semibold hover:bg-gray-800 transition-colors active:scale-95 flex items-center gap-2 cursor-pointer shadow-[0_2px_4px_rgb(0,0,0,0.1)] shrink-0"
        >
          <span>交接</span>
          <Download className="w-3.5 h-3.5 text-white/80" />
        </button>

        {/* User avatar headshot exactly matching URL in mockup */}
        <div className="w-8 h-8 rounded-full bg-[#e6e8ea] border border-[#E2E8F0] overflow-hidden hidden sm:block cursor-pointer hover:ring-2 hover:ring-black hover:ring-offset-2 transition-all">
          <img
            alt="User Profile"
            className="w-full h-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCsSb9yFuif7WlDC5lKXSbfho677Zyg_WlC6HCSk6TcrnZ529kmxG74xAMZRQcshq6xAE_brDWvGLkMqsMEJRF_DVqXoi1Hckz7LvyL1wr9gfjBHCV2oo-ikp3fWXPkX7fT5HgTodlqA07parLa3WLopsPvWavPmO8hQUIwvHvp5DHjWZ_haZNDKIfZNfQ6P8ZzRoFEYdgAucgQmNJ_sKwvV5tBsgdkPUrun-PzCAPQ2KKShEx3_Ys0s7zVMgU44LpEFRWcnoiP0F5M"
          />
        </div>
      </div>
    </header>
  );
}
