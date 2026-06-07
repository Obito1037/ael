/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent } from 'react';
import { 
  ShieldAlert, 
  ChevronRight, 
  RotateCw, 
  BellRing, 
  Bot, 
  Cpu, 
  Sliders, 
  AlertTriangle, 
  X,
  Plus,
  HelpCircle,
  Ban
} from 'lucide-react';
import { FailureDefense, FailureStatus } from '../types';

interface FailureDefenseProps {
  defenseItems: FailureDefense[];
  searchQuery: string;
  onUpdateFailure: (id: string, updated: FailureDefense) => void;
  onAddFailure: (newItem: Omit<FailureDefense, 'id' | 'occurrences'>) => void;
  addToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export default function FailureDefenseComponent({
  defenseItems,
  searchQuery,
  onUpdateFailure,
  onAddFailure,
  addToast
}: FailureDefenseProps) {
  const [globalAlertEnabled, setGlobalAlertEnabled] = useState(true);
  const [selectedItem, setSelectedItem] = useState<FailureDefense | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [status, setStatus] = useState<FailureStatus>('active');
  const [description, setDescription] = useState('');
  const [errorSignature, setErrorSignature] = useState('');
  const [repairMethod, setRepairMethod] = useState('');
  const [constraint, setConstraint] = useState('');
  const [autoRepairActive, setAutoRepairActive] = useState(true);

  // Filter list
  const filteredItems = defenseItems.filter((item) => {
    return (
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.errorSignature.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const getStatusDot = (status: FailureStatus) => {
    switch (status) {
      case 'active':
        return <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]"></span>;
      case 'configured':
        return <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]"></span>;
      case 'logged':
        return <span className="w-1.5 h-1.5 rounded-full bg-[#64748b]"></span>;
    }
  };

  const getStatusText = (status: FailureStatus) => {
    switch (status) {
      case 'active': return '防御激活';
      case 'configured': return '警报已配置';
      case 'logged': return '被动记录';
    }
  };

  const getStatusClass = (status: FailureStatus) => {
    switch (status) {
      case 'active': return 'text-[#ef4444] border-[#ef4444]/20';
      case 'configured': return 'text-[#f59e0b] border-[#f59e0b]/20';
      case 'logged': return 'text-[#64748b] border-[#64748b]/20';
    }
  };

  const handleEditClick = (item: FailureDefense) => {
    setSelectedItem(item);
  };

  const handleSaveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    onUpdateFailure(selectedItem.id, selectedItem);
    setSelectedItem(null);
    addToast(`防御规则 [${selectedItem.name}] 阀值更新成功！`, 'success');
  };

  const handleCreateRule = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onAddFailure({
      name,
      status,
      description,
      errorSignature: errorSignature || 'Exception: Generic Error Occurred',
      repairMethod,
      constraint,
      autoRepairActive
    });

    addToast(`成功部署防御拦截规则: [${name}]`, 'success');

    // Reset Form
    setName('');
    setDescription('');
    setErrorSignature('');
    setRepairMethod('');
    setConstraint('');
    setAutoRepairActive(true);
    setShowAddModal(false);
  };

  const testTriggerDefenseSimulation = (id: string) => {
    const item = defenseItems.find(d => d.id === id);
    if (!item) return;

    // Simulate an occurrence event and running its auto repair!
    addToast(`模拟触发 [${item.name}] 阻断！检测到签名: "${item.errorSignature}"... ${
      item.autoRepairActive 
        ? '触发自动修复成功。' 
        : '被动拦截记录完毕。'
    }`, item.autoRepairActive ? 'success' : 'warning');

    onUpdateFailure(id, {
      ...item,
      occurrences: item.occurrences + 1
    });
  };

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* Page Header and Toggle Alert Configuration */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 border-b border-[#E2E8F0] pb-6">
        <div>
          <h2 className="font-sans text-xl font-bold text-black mb-1">故障防御</h2>
          <p className="font-sans text-xs text-[#747878] max-w-2xl leading-relaxed">
            定义、拦截并解决高阶语言模型的特定异常。自动化智能体可以在配置的修复阈值与约束内执行自我调整。
          </p>
        </div>

        {/* Global alarm toggle inside styled box */}
        <div className="flex items-center gap-3 bg-[#f2f4f6] border border-[#E2E8F0] rounded px-4 py-2 w-full lg:w-auto">
          <BellRing className={`w-[20px] h-[20px] ${globalAlertEnabled ? 'text-[#10b981]' : 'text-[#747878]'}`} />
          <span className="font-sans text-xs font-semibold text-black flex-1 lg:flex-initial">
            全局自动修复与警报: {globalAlertEnabled ? '启用' : '禁用'}
          </span>
          <label className="relative inline-flex items-center cursor-pointer ml-4">
            <input 
              type="checkbox" 
              checked={globalAlertEnabled}
              onChange={(e) => setGlobalAlertEnabled(e.target.checked)}
              className="sr-only peer" 
            />
            <div className="w-9 h-5 bg-[#c4c7c7] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-black"></div>
          </label>
        </div>
      </div>

      {/* Grid of failure mode rules files */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredItems.map((item) => (
          <div
            key={item.id}
            className="bg-white border border-[#E2E8F0] hover:border-black rounded-lg p-5 flex flex-col gap-4 relative overflow-hidden group shadow-xs transition-all"
          >
            {/* Left vertical status indicator line */}
            <div className={`absolute left-0 top-0 bottom-0 w-[4px] ${
              item.status === 'active' ? 'bg-[#ef4444]' :
              item.status === 'configured' ? 'bg-[#f59e0b]' :
              'bg-[#64748b]'
            }`}></div>

            <div className="flex justify-between items-start pl-2">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  {getStatusDot(item.status)}
                  <span className={`font-mono text-[9px] font-bold uppercase tracking-wider ${getStatusClass(item.status)}`}>
                    {getStatusText(item.status)}
                  </span>
                </div>
                <h3 className="font-sans text-base font-bold text-black">{item.name}</h3>
              </div>

              <div className="flex flex-col items-end shrink-0">
                <span className="font-mono text-[10px] text-[#747878] font-semibold">阻断计数</span>
                <span className="font-mono text-sm text-black font-bold">{item.occurrences.toLocaleString()}</span>
              </div>
            </div>

            <p className="font-sans text-xs text-[#747878] pl-2 leading-relaxed">
              {item.description}
            </p>

            {/* Error signature regex or string */}
            <div className="bg-[#f7f9fb] rounded p-3 border border-[#E2E8F0] pl-3">
              <p className="font-mono text-[9px] text-[#747878] mb-1.5 uppercase font-medium">错误签名 Pattern</p>
              <code className="font-mono text-[10px] text-black break-all block py-0.5 select-all leading-normal">
                {item.errorSignature}
              </code>
            </div>

            {/* Constraints and methods column details */}
            <div className="grid grid-cols-2 gap-4 pl-2 mt-1">
              <div>
                <p className="font-mono text-[10px] text-[#747878] mb-1 uppercase font-semibold">修复方法</p>
                <p className={`font-sans text-xs font-semibold ${item.repairMethod === '未定义' ? 'text-[#747878]/60 italic' : 'text-black'}`}>
                  {item.repairMethod}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] text-[#747878] mb-1 uppercase font-semibold">防御约束</p>
                <p className={`font-sans text-xs font-semibold ${item.constraint === '无' ? 'text-[#747878]/60 italic' : 'text-black'}`}>
                  {item.constraint}
                </p>
              </div>
            </div>

            {/* Bottom active block triggers and configure rules actions */}
            <div className="mt-4 pt-4 border-t border-[#E2E8F0] pl-2 flex justify-between items-center flex-wrap gap-3">
              <div className="flex items-center gap-2">
                {item.autoRepairActive ? (
                  <>
                    <Bot className="w-4 h-4 text-[#10b981]" />
                    <span className="font-sans text-xs font-medium text-[#10b981]">自动修复机制正常</span>
                  </>
                ) : (
                  <>
                    <Ban className="w-4 h-4 text-[#747878]" />
                    <span className="font-sans text-xs font-medium text-[#747878]">被动终止当前任务</span>
                  </>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => testTriggerDefenseSimulation(item.id)}
                  className="font-sans text-[10px] font-bold border border-[#E2E8F0] hover:bg-[#f2f4f6] px-2 py-1 rounded transition-colors text-black"
                >
                  测试拦截
                </button>

                <button
                  onClick={() => handleEditClick(item)}
                  className="font-sans text-[10px] font-bold text-[#747878] hover:text-black hover:underline transition-colors"
                >
                  编辑参数
                </button>
              </div>
            </div>

            {/* Conditional warning layout for Mismatch Output schemas */}
            {item.upcomingAlertConfigured && (
              <div className="mt-2 -mx-5 px-6 -mb-5 pb-4 pt-3.5 bg-[#ffdad6]/20 border-t border-[#E2E8F0] flex justify-between items-center text-xs">
                <span className="font-sans text-[#93000a] text-[11px] font-bold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  下次捕获将进行自动阻断警报
                </span>
                <button 
                  onClick={() => {
                    onUpdateFailure(item.id, { ...item, upcomingAlertConfigured: false });
                    addToast('次回拦截的高优先警报预示已解除。', 'info');
                  }}
                  className="px-2 py-0.5 border border-[#ffdad6] bg-white rounded text-[10px] font-bold text-black"
                >
                  解除警报
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Option to insert new failure block */}
        <div 
          onClick={() => setShowAddModal(true)}
          className="border-2 border-dashed border-[#E2E8F0] hover:border-black rounded-lg p-5 flex flex-col justify-center items-center text-center py-12 cursor-pointer group transition-colors bg-white shadow-xs"
        >
          <ShieldAlert className="w-8 h-8 text-[#747878] group-hover:text-black transition-colors mb-3" />
          <h4 className="font-sans text-sm font-bold text-black">录入全新异常捕获</h4>
          <p className="font-sans text-xs text-[#747878] mt-1.5 max-w-xs leading-relaxed">
            在此处添加预期的异常或已知模型错误，配置退避或者重新提示策略，完成自我修复闭环。
          </p>
        </div>
      </div>

      {/* Edit threshold Modal window */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-[#E2E8F0] w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-[#E2E8F0]">
              <h3 className="font-sans text-sm font-bold text-black">更新 [{selectedItem.name}] 防御规范</h3>
              <button 
                onClick={() => setSelectedItem(null)}
                className="text-[#747878] hover:text-black w-7 h-7 rounded flex items-center justify-center hover:bg-[#f2f4f6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form onSubmit={handleSaveEdit} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">阻断计数阀值</label>
                <input 
                  type="number" 
                  value={selectedItem.occurrences}
                  onChange={(e) => setSelectedItem({ ...selectedItem, occurrences: parseInt(e.target.value) || 0 })}
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm bg-[#f2f4f6] focus:bg-white text-black"
                />
              </div>

              <div className="space-y-1">
                <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">修复修复方法</label>
                <input 
                  type="text" 
                  value={selectedItem.repairMethod}
                  onChange={(e) => setSelectedItem({ ...selectedItem, repairMethod: e.target.value })}
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm bg-[#f2f4f6] focus:bg-white text-black"
                />
              </div>

              <div className="space-y-1">
                <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">防御防御约束</label>
                <input 
                  type="text" 
                  value={selectedItem.constraint}
                  onChange={(e) => setSelectedItem({ ...selectedItem, constraint: e.target.value })}
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm bg-[#f2f4f6] focus:bg-white text-black"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox"
                  id="edit-auto-repair"
                  checked={selectedItem.autoRepairActive}
                  onChange={(e) => setSelectedItem({ ...selectedItem, autoRepairActive: e.target.checked })}
                  className="w-4 h-4 rounded text-black focus:ring-black accent-black"
                />
                <label htmlFor="edit-auto-repair" className="font-sans text-xs font-semibold text-black">开启自动后台修复</label>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="px-4 py-2 border border-[#E2E8F0] rounded text-xs font-semibold text-black hover:bg-[#f2f4f6]"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-black text-white rounded text-xs font-semibold hover:opacity-90"
                >
                  保存参数
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Rule Modal window */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-[#E2E8F0] w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-[#E2E8F0]">
              <h3 className="font-sans text-sm font-bold text-black flex items-center gap-1.5">
                <ShieldAlert className="w-5 h-5 text-black" />
                录入新防御拦截规范
              </h3>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-[#747878] hover:text-black w-7 h-7 rounded flex items-center justify-center hover:bg-[#f2f4f6]"
              >
                <X className="w-4 h-4 text-black" />
              </button>
            </div>
            
            <form onSubmit={handleCreateRule} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">故障类型名称 (FAILURE TYPE NAME)</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如: API Access Denied"
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none focus:border-black transition-all"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">详细成因描述 (DESCRIPTION)</label>
                <input 
                  type="text" 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="如: OAuth 令牌在长时间调用期间过期，且刷新指令响应失败..."
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none focus:border-black transition-all"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">识别错误签名 Pattern (ERROR SIGNATURE)</label>
                <input 
                  type="text" 
                  value={errorSignature}
                  onChange={(e) => setErrorSignature(e.target.value)}
                  placeholder="如: exceptions.UnauthorizedError: Token has expired"
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none focus:border-black transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">自动修复方法</label>
                  <input 
                    type="text" 
                    value={repairMethod}
                    onChange={(e) => setRepairMethod(e.target.value)}
                    placeholder="如: 重新请求 OAuth 续期"
                    className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none focus:border-black transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">约束条件 LIMIT</label>
                  <input 
                    type="text" 
                    value={constraint}
                    onChange={(e) => setConstraint(e.target.value)}
                    placeholder="如: 最大重试一次"
                    className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none focus:border-black transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">初始拦截模式 status</label>
                  <select 
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6]"
                  >
                    <option value="active">自动防御激活 (active)</option>
                    <option value="configured">阻断警报已配置 (configured)</option>
                    <option value="logged">被动仅仅记录 (logged)</option>
                  </select>
                </div>

                <div className="space-y-1 pt-6 flex items-center gap-2">
                  <input 
                    type="checkbox"
                    id="auto-repair-check"
                    checked={autoRepairActive}
                    onChange={(e) => setAutoRepairActive(e.target.checked)}
                    className="w-4 h-4 rounded text-black focus:ring-black accent-black"
                  />
                  <label htmlFor="auto-repair-check" className="font-sans text-xs font-semibold text-black">启用自动修复</label>
                </div>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-[#E2E8F0] rounded text-xs font-semibold text-black hover:bg-[#f2f4f6]"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-black text-white rounded text-xs font-semibold hover:opacity-90"
                >
                  添加阻断规则
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
