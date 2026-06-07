/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent } from 'react';
import { Cpu, RotateCw, Play, Plus, X, Tag } from 'lucide-react';
import { Skill, SkillStatus } from '../types';

interface SkillsLibraryProps {
  skills: Skill[];
  searchQuery: string;
  statusFilter: string;
  onAddSkill: (newSkill: Omit<Skill, 'id'>) => void;
  onTriggerSkill: (skillId: string) => void;
  addToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export default function SkillsLibrary({
  skills,
  searchQuery,
  statusFilter,
  onAddSkill,
  onTriggerSkill,
  addToast
}: SkillsLibraryProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<SkillStatus>('active');
  const [trigger, setTrigger] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  // Filter skills
  const filteredSkills = skills.filter((skill) => {
    const matchesSearch = 
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.trigger.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));

    let matchesStatus = true;
    if (statusFilter !== '全部状态') {
      const statusMap: Record<string, SkillStatus> = {
        '活跃': 'active',
        '草稿': 'draft',
        '已弃用': 'deprecated'
      };
      matchesStatus = skill.status === statusMap[statusFilter];
    }

    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: SkillStatus) => {
    switch (status) {
      case 'active':
        return (
          <span className="bg-[#10b981]/10 text-[#10b981] font-mono text-[10px] px-2 py-0.5 rounded flex items-center gap-1 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></span>活跃
          </span>
        );
      case 'draft':
        return (
          <span className="bg-[#3b82f6]/10 text-[#3b82f6] font-mono text-[10px] px-2 py-0.5 rounded flex items-center gap-1 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6]"></span>草稿
          </span>
        );
      case 'deprecated':
        return (
          <span className="bg-[#64748b]/10 text-[#64748b] font-mono text-[10px] px-2 py-0.5 rounded flex items-center gap-1 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#64748b]"></span>已弃用
          </span>
        );
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    onAddSkill({
      name: name.replace(/\s+/g, ''),
      status,
      trigger: trigger || 'manual_invocation',
      successCount: status === 'draft' ? '-' : 0,
      failureCount: status === 'draft' ? '-' : 0,
      tags: tags.length ? tags : ['custom']
    });

    addToast(`新技能 [${name}] 已成功注册至系统。`, 'success');

    setName('');
    setTrigger('');
    setTagsInput('');
    setStatus('active');
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header and counter */}
      <div className="flex justify-between items-end border-b border-[#E2E8F0] pb-6">
        <div>
          <h2 className="font-sans text-xl font-bold text-black mb-1">技能库</h2>
          <p className="font-sans text-xs text-[#747878] leading-relaxed">
            管理、调用和自动化监控可复用的 Agent 业务执行机能。
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="font-mono text-xs text-[#747878] bg-[#f2f4f6] px-2.5 py-1 rounded font-semibold hidden sm:block">
            总计：{skills.length} | 活跃：{skills.filter(s => s.status === 'active').length}
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-black text-white hover:opacity-90 transition-opacity rounded font-sans text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 duration-100"
          >
            <Plus className="w-4 h-4" />
            新建技能
          </button>
        </div>
      </div>

      {/* Grid of skill cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSkills.map((skill) => (
          <div
            key={skill.id}
            className={`bg-white border rounded-lg p-5 flex flex-col hover:border-black transition-all relative group shadow-xs ${
              skill.status === 'deprecated' ? 'opacity-70 hover:opacity-100' : ''
            }`}
          >
            {/* Run button overlay purely on hover of active skills */}
            {skill.status === 'active' && (
              <button
                onClick={() => onTriggerSkill(skill.id)}
                title="手动执行触发遥测单次流转"
                className="absolute right-4 bottom-4 w-7 h-7 bg-black text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity active:scale-90 shadow-sm cursor-pointer z-20"
              >
                <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
              </button>
            )}

            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded bg-[#f2f4f6] flex items-center justify-center text-black">
                  <Cpu className="w-4 h-4" />
                </div>
                <h3 className={`font-sans text-sm font-bold text-black ${
                  skill.status === 'deprecated' ? 'line-through text-[#747878]' : ''
                }`}>
                  {skill.name}
                </h3>
              </div>
              {getStatusBadge(skill.status)}
            </div>

            {/* Code condition trigger */}
            <div className="mb-4 bg-[#f2f4f6] p-2.5 rounded border border-[#E2E8F0]/50 font-mono text-[11px] text-[#444748] break-all leading-normal select-all">
              触发器：{skill.trigger}
            </div>

            {/* Run totals display block */}
            <div className="grid grid-cols-2 gap-2 mb-4 font-mono text-xs">
              <div className="flex flex-col">
                <span className="text-[#747878] font-bold text-[10px] uppercase">成功调用</span>
                <span className="text-black text-sm font-bold mt-0.5">
                  {typeof skill.successCount === 'number' 
                    ? skill.successCount.toLocaleString() 
                    : skill.successCount}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[#747878] font-bold text-[10px] uppercase">失败次数</span>
                <span className={`text-[#ef4444] text-sm font-bold mt-0.5 ${
                  skill.failureCount === 0 ? 'text-[#747878]' : ''
                }`}>
                  {typeof skill.failureCount === 'number' 
                    ? skill.failureCount.toLocaleString() 
                    : skill.failureCount}
                </span>
              </div>
            </div>

            {/* Footer tags */}
            <div className="mt-auto flex gap-1.5 flex-wrap">
              {skill.tags.map(tag => (
                <span 
                  key={tag} 
                  className="px-2 py-0.5 bg-[#f2f4f6] border border-[#E2E8F0] rounded text-[#444748] font-mono text-[10px] uppercase font-semibold"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}

        {filteredSkills.length === 0 && (
          <div className="col-span-full text-center py-12 border border-dashed border-[#E2E8F0] bg-white rounded-lg text-[#747878] text-sm font-sans">
            无相符技能组件组件。您可以添加新技能或重置搜索！
          </div>
        )}
      </div>

      {/* Creation Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#E2E8F0] w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-black" />
                <h3 className="font-sans text-sm font-bold text-black font-sans">设计全新技能节点</h3>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-[#747878] hover:text-black w-7 h-7 rounded flex items-center justify-center hover:bg-[#f2f4f6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">技能识别名 (SKILL NAME)</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如: SendSlackDigest"
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none focus:border-black transition-all"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">触发规则 (TRIGGER SPECIFICATION)</label>
                <input 
                  type="text" 
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                  placeholder='如: event.type == "payment.completed"'
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none focus:border-black transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">发布状态 (STATUS)</label>
                  <select 
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none"
                  >
                    <option value="active">活跃 (Active)</option>
                    <option value="draft">草稿 (Draft)</option>
                    <option value="deprecated">弃用 (Deprecated)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">业务标签 (Tags, split by comma)</label>
                  <input 
                    type="text" 
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="如: comms, notification"
                    className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none focus:border-black transition-all"
                  />
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
                  确认启用
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
