/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent } from 'react';
import { 
  RotateCw, 
  Ban, 
  Hourglass, 
  CheckCircle2, 
  Bot, 
  Clock, 
  Plus, 
  X,
  Sparkles
} from 'lucide-react';
import { Task, TaskStatus } from '../types';

interface TaskListProps {
  tasks: Task[];
  searchQuery: string;
  statusFilter: string;
  onSelectTask: (task: Task) => void;
  onAddTask: (newTask: Omit<Task, 'id' | 'updateTimeAgo' | 'timeline'>) => void;
  addToast: (msg: string, type: 'info'|'success'|'warning'|'error') => void;
}

export default function TaskList({ 
  tasks, 
  searchQuery, 
  statusFilter, 
  onSelectTask,
  onAddTask,
  addToast
}: TaskListProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agentName, setAgentName] = useState('Agent-Alpha');
  const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('High');
  const [tagInput, setTagInput] = useState('');
  const [status, setStatus] = useState<TaskStatus>('in_progress');

  // Compute stats dynamically
  const totalInFlight = tasks.length;
  const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
  const blockedCount = tasks.filter(t => t.status === 'blocked').length;
  const completedCount = tasks.filter(t => t.status === 'verified').length;

  // Filter task list
  const filteredTasks = tasks.filter((task) => {
    // Search match
    const matchesSearch = 
      task.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.description.toLowerCase().includes(searchQuery.toLowerCase());

    // Status filter match
    let matchesStatus = true;
    if (statusFilter !== '全部状态') {
      const statusMap: Record<string, TaskStatus> = {
        '进行中': 'in_progress',
        '阻塞': 'blocked',
        '待处理': 'pending',
        '已验证': 'verified'
      };
      matchesStatus = task.status === statusMap[statusFilter];
    }

    return matchesSearch && matchesStatus;
  });

  const getStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'in_progress':
        return <RotateCw className="w-5 h-5 text-[#3b82f6] animate-spin-slow shrink-0" />;
      case 'blocked':
        return <Ban className="w-5 h-5 text-[#f59e0b] shrink-0" />;
      case 'pending':
        return <Hourglass className="w-5 h-5 text-[#64748b] shrink-0" />;
      case 'verified':
        return <CheckCircle2 className="w-5 h-5 text-[#10b981] shrink-0" />;
    }
  };

  const getStatusText = (status: TaskStatus) => {
    switch (status) {
      case 'in_progress': return '进行中';
      case 'blocked': return '阻塞';
      case 'pending': return '待处理';
      case 'verified': return '已验证';
    }
  };

  const getStatusClass = (status: TaskStatus) => {
    switch (status) {
      case 'in_progress': return 'bg-[#3b82f6]/10 text-[#3b82f6]';
      case 'blocked': return 'bg-[#f59e0b]/10 text-[#f59e0b]';
      case 'pending': return 'bg-[#64748b]/10 text-[#64748b]';
      case 'verified': return 'bg-[#10b981]/10 text-[#10b981]';
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      addToast('请填写任务标题（Title）与详细描述！', 'warning');
      return;
    }
    
    const tags = tagInput
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);

    onAddTask({
      title,
      description,
      status,
      agentName,
      priority,
      tags: tags.length ? tags : ['General']
    });

    addToast('已将新任务纳入执行队列及资源管辖池中。', 'success');

    // Reset fields
    setTitle('');
    setDescription('');
    setAgentName('Agent-Alpha');
    setPriority('High');
    setTagInput('');
    setStatus('in_progress');
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Page Header and counter badges */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 border-b border-[#E2E8F0] pb-6">
        <div>
          <h2 className="font-sans text-xl font-bold text-black mb-1">活动任务</h2>
          <p className="font-mono text-xs text-[#747878] leading-relaxed">
            {totalInFlight} 个登记任务 &bull; {inProgressCount} 个运行中 &bull; {blockedCount} 个被拦截 &bull; 今日已验证 {completedCount} 个
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-black text-white hover:opacity-90 transition-opacity rounded font-sans text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-sm ml-auto sm:ml-0 active:scale-95 duration-100"
        >
          <Plus className="w-4 h-4" />
          新建任务
        </button>
      </div>

      {/* Task Stack */}
      <div className="grid grid-cols-1 gap-3">
        {filteredTasks.length > 0 ? (
          filteredTasks.map((task) => (
            <div
              key={task.id}
              onClick={() => onSelectTask(task)}
              className="bg-white border border-[#E2E8F0] hover:border-black rounded-lg p-4 transition-all duration-150 cursor-pointer group flex items-start gap-4 hover:shadow-xs active:bg-[#f2f4f6]"
            >
              <div className="mt-1 shrink-0">
                {getStatusIcon(task.status)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                  <span className="font-mono text-[10px] text-[#747878] font-bold bg-[#f2f4f6] px-1.5 py-0.5 rounded">
                    {task.id}
                  </span>
                  <h3 className="font-sans text-sm font-bold text-black truncate group-hover:text-[#712ae2] transition-colors flex-1">
                    {task.title}
                  </h3>
                  <div className="ml-auto">
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full font-sans text-[10px] font-bold uppercase tracking-wider ${getStatusClass(task.status)}`}>
                      <span className={`w-1 h-1 rounded-full ${
                        task.status === 'in_progress' ? 'bg-[#3b82f6]' :
                        task.status === 'blocked' ? 'bg-[#f59e0b]' :
                        task.status === 'pending' ? 'bg-[#64748b]' :
                        'bg-[#10b981]'
                      }`}></span>
                      {getStatusText(task.status)}
                    </span>
                  </div>
                </div>

                <p className="font-sans text-xs text-[#747878] mb-3 line-clamp-2 leading-relaxed">
                  {task.description}
                </p>

                <div className="flex items-center gap-4 text-[#747878] flex-wrap">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase font-bold">
                    <Bot className="w-3.5 h-3.5" />
                    <span>{task.agentName}</span>
                  </div>
                  <div className="w-1 h-1 rounded-full bg-[#E2E8F0]"></div>
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{task.updateTimeAgo}</span>
                  </div>
                  {task.priority && (
                    <>
                      <div className="w-1 h-1 rounded-full bg-[#E2E8F0]"></div>
                      <span className={`font-mono text-[10px] font-bold ${
                        task.priority === 'High' ? 'text-[#ef4444]' :
                        task.priority === 'Medium' ? 'text-[#f59e0b]' :
                        'text-[#10b981]'
                      }`}>
                        Priority: {task.priority}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-12 border border-dashed border-[#E2E8F0] bg-white rounded-lg text-[#747878] text-sm">
            没有找到符合当前条件的工作任务。您可以选择更改状态筛选，或新建任务启动新进程！
          </div>
        )}
      </div>

      {/* Creation Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-[#E2E8F0] w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#7c3aed]" />
                <h3 className="font-sans text-sm font-bold text-black">注册全新 Agent 执行任务</h3>
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
                <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">任务名称 (TASK TITLE)</label>
                <input 
                  type="text" 
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="如：Optimize PostgreSQL explain analyze logic"
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none focus:border-black transition-all"
                />
              </div>

              <div className="space-y-1">
                <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">详细任务指令 (TASK DESCRIPTION)</label>
                <textarea 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="详细描述需要解决的痛点、异常现象以及评估成功与否的指标..."
                  rows={3}
                  className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none focus:border-black transition-all"
                ></textarea>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">分配智能体 (AGENT IN CHARGE)</label>
                  <select 
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none"
                  >
                    <option value="Agent-Alpha">Agent-Alpha (Pipeline Core)</option>
                    <option value="Agent-Beta">Agent-Beta (Integration Core)</option>
                    <option value="Agent-Gamma">Agent-Gamma (E2E Specialist)</option>
                    <option value="Optimizer-V4">Optimizer-V4 (DBMS Analyst)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">优先级 (PRIORITY)</label>
                  <select 
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none"
                  >
                    <option value="High">🔥 High (高优先级)</option>
                    <option value="Medium">⚡ Medium (中优先级)</option>
                    <option value="Low">💤 Low (低优先级)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">任务状态</label>
                  <select 
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full border border-[#E2E8F0] rounded p-2 text-sm text-black bg-[#f2f4f6] focus:bg-white focus:outline-none"
                  >
                    <option value="in_progress">进行中</option>
                    <option value="blocked">阻塞</option>
                    <option value="pending">待待处理</option>
                    <option value="verified">完成并已验证</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-sans text-[11px] font-bold text-[#747878] uppercase">归类标签 (Tags split by comma)</label>
                  <input 
                    type="text" 
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="如: DB, Backend, Ingestion"
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
                  确认启动
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
