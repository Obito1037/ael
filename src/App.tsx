/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useEffect } from 'react';
import { 
  ClipboardList, 
  Puzzle, 
  ShieldAlert, 
  Settings as SettingsIcon, 
  X,
  Plus,
  Compass,
  CheckCircle2,
  Terminal,
  Cpu,
  RefreshCw,
  Sliders,
  Sparkles,
  Info
} from 'lucide-react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import TaskList from './components/TaskList';
import TaskDetail from './components/TaskDetail';
import SkillsLibrary from './components/SkillsLibrary';
import FailureDefenseComponent from './components/FailureDefense';
import HandoverModal from './components/HandoverModal';
import SettingsView from './components/SettingsView';
import ToastContainer, { ToastData } from './components/Toast';
import { Task, Skill, FailureDefense, TaskStatus } from './types';
import { INITIAL_TASKS, INITIAL_SKILLS, INITIAL_FAILURES } from './data';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'tasks' | 'skills' | 'failures' | 'settings'>('tasks');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('全部状态');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isHandoverOpen, setIsHandoverOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = (message: string, type: ToastData['type'] = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Core databases state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [failures, setFailures] = useState<FailureDefense[]>([]);

  // Load and cache initial data arrays
  useEffect(() => {
    const cachedTasks = localStorage.getItem('ael_tasks');
    const cachedSkills = localStorage.getItem('ael_skills');
    const cachedFailures = localStorage.getItem('ael_failures');

    if (cachedTasks) {
      setTasks(JSON.parse(cachedTasks));
    } else {
      setTasks(INITIAL_TASKS);
      localStorage.setItem('ael_tasks', JSON.stringify(INITIAL_TASKS));
    }

    if (cachedSkills) {
      setSkills(JSON.parse(cachedSkills));
    } else {
      setSkills(INITIAL_SKILLS);
      localStorage.setItem('ael_skills', JSON.stringify(INITIAL_SKILLS));
    }

    if (cachedFailures) {
      setFailures(JSON.parse(cachedFailures));
    } else {
      setFailures(INITIAL_FAILURES);
      localStorage.setItem('ael_failures', JSON.stringify(INITIAL_FAILURES));
    }
  }, []);

  // Update localStorage helper
  const saveTasks = (updated: Task[]) => {
    setTasks(updated);
    localStorage.setItem('ael_tasks', JSON.stringify(updated));
  };

  const saveSkills = (updated: Skill[]) => {
    setSkills(updated);
    localStorage.setItem('ael_skills', JSON.stringify(updated));
  };

  const saveFailures = (updated: FailureDefense[]) => {
    setFailures(updated);
    localStorage.setItem('ael_failures', JSON.stringify(updated));
  };

  // Synchronize state filter resets on tab change
  const handleTabChange = (tab: 'tasks' | 'skills' | 'failures' | 'settings') => {
    setCurrentTab(tab);
    setSearchQuery('');
    setStatusFilter('全部状态');
    setMobileMenuOpen(false);
  };

  // Action handlers
  const handleSelectTask = (task: Task) => {
    setSelectedTask(task);
    // Also update current tab back to tasks so it shows the detail view!
    setCurrentTab('tasks');
  };

  const handleUpdateTaskStatus = (taskId: string, newStatus: TaskStatus) => {
    const updated = tasks.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          status: newStatus,
          updateTimeAgo: 'Just now',
          timeElapsed: newStatus === 'verified' ? t.timeElapsed : '02h 50m 10s'
        };
      }
      return t;
    });
    saveTasks(updated);

    // Refresh active selected task in details view too
    if (selectedTask && selectedTask.id === taskId) {
      setSelectedTask(updated.find(t => t.id === taskId) || null);
    }
  };

  const handleAddTask = (newTask: Omit<Task, 'id' | 'updateTimeAgo' | 'timeline'>) => {
    const nextIndex = tasks.length + 1;
    const padding = nextIndex < 10 ? '0' : '';
    const newId = `TSK-89${padding}${nextIndex}`;
    
    const taskObj: Task = {
      ...newTask,
      id: newId,
      updateTimeAgo: 'Created just now',
      timeline: [
        {
          id: `ev-${newId}-1`,
          type: 'analysis',
          timestamp: 'Just now',
          title: '线程初始化',
          description: `Allocated process registers. Instantiated sandbox for core instruction: "${newTask.title}".`
        }
      ]
    };

    const updated = [taskObj, ...tasks];
    saveTasks(updated);
  };

  const handleAddSkill = (newSkill: Omit<Skill, 'id'>) => {
    const skillObj: Skill = {
      ...newSkill,
      id: `skill-${skills.length + 1}`
    };
    saveSkills([...skills, skillObj]);
  };

  const handleTriggerSkill = (skillId: string) => {
    const updated = skills.map((s) => {
      if (s.id === skillId && typeof s.successCount === 'number') {
        return {
          ...s,
          successCount: s.successCount + 1
        };
      }
      return s;
    });
    saveSkills(updated);
    
    // Quick pop alert for dynamic trigger feed
    const triggerSkill = skills.find(s => s.id === skillId);
    if (triggerSkill) {
      addToast(`测试触发成功！技能名称: [${triggerSkill.name}]... 指标已递增。`, 'success');
    }
  };

  const handleUpdateFailure = (id: string, updatedItem: FailureDefense) => {
    const updated = failures.map(f => f.id === id ? updatedItem : f);
    saveFailures(updated);
  };

  const handleAddFailure = (newItem: Omit<FailureDefense, 'id' | 'occurrences'>) => {
    const failObj: FailureDefense = {
      ...newItem,
      id: `fail-${failures.length + 1}`,
      occurrences: 0
    };
    saveFailures([...failures, failObj]);
  };

  const handleRefresh = () => {
    // Refresh simulation triggers standard audit logs
    const updatedFailures = failures.map((f, i) => {
      // Small random increments to look highly continuous and alive!
      if (i === 0 && f.occurrences > 0) {
        return { ...f, occurrences: f.occurrences + Math.floor(Math.random() * 3) };
      }
      return f;
    });
    saveFailures(updatedFailures);
    addToast('正在获取最新多 Agent 执行上下文... 所有数据通道同步完成！', 'success');
  };

  // Reset original data database
  const handleResetDatabase = () => {
    if (confirm('确认还原系统日志数据库至 AEL v1.2.0-stable 初始预装数据？这会移除任何您自定义添加的任务与技能指标。')) {
      localStorage.removeItem('ael_tasks');
      localStorage.removeItem('ael_skills');
      localStorage.removeItem('ael_failures');
      setTasks(INITIAL_TASKS);
      setSkills(INITIAL_SKILLS);
      setFailures(INITIAL_FAILURES);
      setSelectedTask(null);
      setCurrentTab('tasks');
      addToast('系统数据库已恢复至原始装配状态。', 'info');
    }
  };

  return (
    <div className="bg-[#f7f9fb] text-black min-h-screen selection:bg-[#E2E8F0] selection:text-black antialiased font-sans flex flex-col md:flex-row relative">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      {/* Sidebar - Desktop view */}
      <Sidebar currentTab={currentTab} setCurrentTab={handleTabChange} addToast={addToast} />

      {/* Sidebar - Mobile responsive overlay drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex md:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div 
            className="w-[240px] bg-white h-full p-6 flex flex-col gap-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-4 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-black text-white rounded flex items-center justify-center font-bold text-sm">A</div>
                <span className="font-sans font-bold text-black text-lg">AEL Registry</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="text-[#747878] hover:text-black">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-2">
              <button
                onClick={() => handleTabChange('tasks')}
                className={`flex items-center gap-3 px-4 py-2.5 rounded text-left font-sans text-sm ${
                  currentTab === 'tasks' ? 'font-semibold bg-[#eceef0] border-l-2 border-black' : 'text-[#444748] hover:bg-[#f2f4f6]'
                }`}
              >
                <ClipboardList className="w-5 h-5 text-black" />
                <span>任务</span>
              </button>
              <button
                onClick={() => handleTabChange('skills')}
                className={`flex items-center gap-3 px-4 py-2.5 rounded text-left font-sans text-sm ${
                  currentTab === 'skills' ? 'font-semibold bg-[#eceef0] border-l-2 border-black' : 'text-[#444748] hover:bg-[#f2f4f6]'
                }`}
              >
                <Puzzle className="w-5 h-5 text-black" />
                <span>技能</span>
              </button>
              <button
                onClick={() => handleTabChange('failures')}
                className={`flex items-center gap-3 px-4 py-2.5 rounded text-left font-sans text-sm ${
                  currentTab === 'failures' ? 'font-semibold bg-[#eceef0] border-l-2 border-black' : 'text-[#444748] hover:bg-[#f2f4f6]'
                }`}
              >
                <ShieldAlert className="w-5 h-5 text-black" />
                <span>故障模式</span>
              </button>
              <button
                onClick={() => handleTabChange('settings')}
                className={`flex items-center gap-3 px-4 py-2.5 rounded text-left font-sans text-sm ${
                  currentTab === 'settings' ? 'font-semibold bg-[#eceef0] border-l-2 border-black' : 'text-[#444748] hover:bg-[#f2f4f6]'
                }`}
              >
                <SettingsIcon className="w-5 h-5 text-black" />
                <span>设置</span>
              </button>
            </nav>
            <div className="mt-auto pt-4 border-t border-[#E2E8F0]">
              <p className="font-mono text-[9px] text-[#747878]">SYSTEM CODENAME: ANTIGRAVITY</p>
            </div>
          </div>
        </div>
      )}

      {/* Right Core Workspace Panel */}
      <div className="flex-1 min-w-0 md:pl-[240px]">
        
        {/* Persistent top Header Controls */}
        <Header 
          currentTab={currentTab}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          onRefresh={handleRefresh}
          onExportHandover={() => setIsHandoverOpen(true)}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          addToast={addToast}
        />

        {/* Viewport content */}
        <main className="pt-24 px-6 md:px-8 pb-12 w-full max-w-[1100px] mx-auto min-h-[calc(100vh-64px)] overflow-x-hidden">
          
          {currentTab === 'tasks' && (
            selectedTask ? (
              <TaskDetail 
                task={selectedTask} 
                onBack={() => setSelectedTask(null)}
                onUpdateStatus={handleUpdateTaskStatus}
                addToast={addToast}
              />
            ) : (
              <TaskList 
                tasks={tasks}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                onSelectTask={handleSelectTask}
                onAddTask={handleAddTask}
                addToast={addToast}
              />
            )
          )}

          {currentTab === 'skills' && (
            <SkillsLibrary 
              skills={skills}
              searchQuery={searchQuery}
              statusFilter={statusFilter}
              onAddSkill={handleAddSkill}
              onTriggerSkill={handleTriggerSkill}
              addToast={addToast}
            />
          )}

          {currentTab === 'failures' && (
            <FailureDefenseComponent 
              defenseItems={failures}
              searchQuery={searchQuery}
              onUpdateFailure={handleUpdateFailure}
              onAddFailure={handleAddFailure}
              addToast={addToast}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView 
              onResetDatabase={handleResetDatabase} 
              addToast={addToast} 
            />
          )}

        </main>
      </div>

      {/* Global Handover Packet popup Overlay */}
      {isHandoverOpen && (
        <HandoverModal 
          task={selectedTask || {
            id: 'GLOBAL',
            title: '全局系统级 Agent 手册交接 (Global Ledger Takeover)',
            status: 'in_progress',
            description: '包含当前登记的所有执行线程、活跃技能、以及防御模式下的所有拦截实例的全局接手机制。',
            agentName: 'System Operator',
            priority: 'High',
            tags: ['Global', 'Ledger'],
            updateTimeAgo: 'Just now',
            derivedSkills: skills.map(s => s.name),
            timeline: tasks.flatMap(t => t.timeline || [])
          }}
          isOpen={isHandoverOpen} 
          onClose={() => setIsHandoverOpen(false)} 
          addToast={addToast}
        />
      )}

    </div>
  );
}
