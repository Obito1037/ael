/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { 
  Play, 
  Settings, 
  HelpCircle, 
  AlertTriangle, 
  CheckCircle2, 
  RotateCw, 
  Edit3, 
  Activity, 
  ExternalLink, 
  Code, 
  Compass, 
  Wrench, 
  Check, 
  FileCode, 
  Terminal, 
  ArrowLeft,
  X
} from 'lucide-react';
import { Task, TimelineEvent, TaskStatus } from '../types';

interface TaskDetailProps {
  task: Task;
  onBack: () => void;
  onUpdateStatus: (taskId: string, newStatus: TaskStatus) => void;
  addToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export default function TaskDetail({ task, onBack, onUpdateStatus, addToast }: TaskDetailProps) {
  const [editingStatus, setEditingStatus] = useState(false);
  const [showExplainModal, setShowExplainModal] = useState(false);

  // Status-specific color mapping
  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'in_progress':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#3b82f6]/10 text-[#3b82f6] font-sans text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6]"></span>
            进行中
          </span>
        );
      case 'blocked':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] font-sans text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]"></span>
            已阻塞
          </span>
        );
      case 'pending':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#64748b]/10 text-[#64748b] font-sans text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#64748b]"></span>
            待处理
          </span>
        );
      case 'verified':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#10b981]/10 text-[#10b981] font-sans text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></span>
            已验证
          </span>
        );
      default:
        return null;
    }
  };

  // Render icons dynamically for timeline events
  const getTimelineIcon = (type: string) => {
    switch (type) {
      case 'analysis':
        return <Code className="w-4 h-4 text-[#747878]" />;
      case 'error':
        return <AlertTriangle className="w-4 h-4 text-[#ef4444]" />;
      case 'decision':
        return <Compass className="w-4 h-4 text-[#7c3aed]" />;
      case 'fix':
        return <Wrench className="w-4 h-4 text-[#10b981]" />;
      case 'verification':
        return <Activity className="w-4 h-4 text-[#3b82f6]" />;
      default:
        return <Activity className="w-4 h-4 text-[#444748]" />;
    }
  };

  // Timeline events representing custom logs for alternate tasks
  const getSimulatedTimeline = (): TimelineEvent[] => {
    if (task.timeline && task.timeline.length > 0) {
      return task.timeline;
    }

    // Default timeline if none available
    switch (task.status) {
      case 'blocked':
        return [
          {
            id: 'ev-alt-1',
            type: 'analysis',
            timestamp: '02:15 PM',
            title: '依赖性静态扫描',
            description: 'Initiated integration checks on staging credentials vault endpoint.'
          },
          {
            id: 'ev-alt-2',
            type: 'error',
            timestamp: '02:18 PM',
            title: '密钥缺失拦截',
            description: 'OAuth credentials and secret webhook signing strings are absent in the secure parameters store.',
            extraCode: "StripeSignatureVerificationError: No secret found in configurations for environment 'staging'"
          },
          {
            id: 'ev-alt-3',
            type: 'decision',
            timestamp: '02:30 PM',
            title: '线程暂停排队',
            description: 'Marked thread as Blocked. Awaiting operator input via variables integration panel to hot-inject signature keys.'
          }
        ];
      case 'verified':
        return [
          {
            id: 'ev-ver-1',
            type: 'analysis',
            timestamp: 'Yesterday',
            title: '源文件检测',
            description: 'Inspected standard dependencies index. Located React Router v5 references.'
          },
          {
            id: 'ev-ver-2',
            type: 'decision',
            timestamp: 'Yesterday',
            title: '升级路径适配',
            description: 'Opted for route config migration script to match React Router v6 specifications.'
          },
          {
            id: 'ev-ver-3',
            type: 'fix',
            timestamp: 'Yesterday',
            title: '自动重构编译',
            description: 'Automated refactoring tools successfully ran 4 replacement procedures on router paths.',
            fileAttachment: 'routes_v6_manifest.tsx'
          },
          {
            id: 'ev-ver-4',
            type: 'verification',
            timestamp: 'Yesterday',
            title: '集成测试验证',
            description: 'All 15 E2E Playwright routes are verified green (Status code 200 checks passed).'
          }
        ];
      default:
        return [
          {
            id: 'ev-def-1',
            type: 'analysis',
            timestamp: '01:00 PM',
            title: '任务初始化',
            description: 'Task received by ledger queue. Allocating ephemeral thread sandbox pools.'
          },
          {
            id: 'ev-def-2',
            type: 'verification',
            timestamp: '01:05 PM',
            title: '资源准备完毕',
            description: 'All compiler environments compiled correctly. Awaiting instructions.'
          }
        ];
    }
  };

  const timeline = getSimulatedTimeline();

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Back to task list */}
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-[#444748] hover:text-black transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回任务列表
      </button>

      {/* Task Header Bento Box */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 flex flex-col md:flex-row gap-6 justify-between items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="font-mono text-xs text-[#747878] font-semibold">{task.id}</span>
            {getStatusBadge(task.status)}
          </div>
          <h2 className="font-sans text-[22px] font-bold text-black tracking-tight mb-3 leading-tight">
            {task.title}
          </h2>
          <p className="font-sans text-sm text-[#444748] mb-4 max-w-3xl leading-relaxed">
            {task.description}
          </p>

          <div className="flex flex-wrap gap-2">
            <span className="px-2 py-1 bg-[#f2f4f6] border border-[#E2E8F0] rounded text-[#444748] font-mono text-[11px]">
              Agent: {task.agentName || 'Optimizer-V4'}
            </span>
            <span className="px-2 py-1 bg-[#f2f4f6] border border-[#E2E8F0] rounded text-[#444748] font-mono text-[11px]">
              优先级: {task.priority || 'High'}
            </span>
            {task.tags && task.tags.map(tag => (
              <span key={tag} className="px-2 py-1 bg-[#f2f4f6] border border-[#E2E8F0] rounded text-[#444748] font-mono text-[11px]">
                标记: {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Dynamic Controls / Time Elapsed */}
        <div className="flex flex-col gap-3 min-w-[200px] w-full md:w-auto">
          <div className="relative">
            {editingStatus ? (
              <div className="flex flex-col gap-1.5 p-3.5 bg-[#f2f4f6] border border-[#E2E8F0] rounded">
                <span className="font-sans text-[10px] font-bold text-[#747878] uppercase">变更任务状态</span>
                <div className="flex flex-col gap-1">
                  {(['in_progress', 'blocked', 'pending', 'verified'] as TaskStatus[]).map((st) => (
                    <button
                      key={st}
                      onClick={() => {
                        onUpdateStatus(task.id, st);
                        setEditingStatus(false);
                      }}
                      className="w-full text-left px-2 py-1 text-xs hover:bg-white rounded text-black transition-colors flex items-center justify-between"
                    >
                      <span className="capitalize">{st.replace('_', ' ')}</span>
                      {task.status === st && <Check className="w-3.5 h-3.5 text-black" />}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setEditingStatus(false)}
                  className="mt-1 text-center font-sans text-[10px] border border-[#E2E8F0] rounded py-0.5 hover:bg-white transition-colors text-black"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingStatus(true)}
                className="w-full bg-white border border-[#E2E8F0] text-black hover:bg-[#f2f4f6] transition-colors px-4 py-2 rounded font-sans text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer active:scale-95 duration-100"
              >
                <span>更新状态</span>
                <Edit3 className="w-3.5 h-3.5 text-[#747878]" />
              </button>
            )}
          </div>

          <div className="p-4 bg-[#f2f4f6] rounded border border-[#E2E8F0]">
            <p className="font-mono text-[10px] text-[#747878] mb-1 uppercase font-semibold">已用工作小时</p>
            <p className="font-sans text-lg font-bold text-black tracking-tight">
              {task.timeElapsed || '01h 12m 40s'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Sections: Timeline vs. Context Metadata */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left main timeline: Evidence Chain */}
        <div className="lg:col-span-2">
          <h3 className="font-sans text-sm font-bold text-black mb-4 uppercase tracking-wider flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#444748]" />
            证据链 (TIMELINE LOGS)
          </h3>

          <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
            <div className="relative">
              {timeline.map((event, index) => {
                const isLast = index === timeline.length - 1;
                return (
                  <div key={event.id} className="thread-item relative pl-12 pb-8">
                    {/* Vertical connector line */}
                    {!isLast && <div className="thread-line"></div>}

                    {/* Node icon with custom status colored background */}
                    <div className={`absolute left-0 top-0 w-8 h-8 rounded-full bg-white border flex items-center justify-center z-10 ${
                      event.type === 'error' ? 'border-[#ef4444]/30 bg-[#ef4444]/5' :
                      event.type === 'decision' ? 'border-[#7c3aed] bg-[#7c3aed]/5 shadow-xs' :
                      event.type === 'fix' ? 'border-[#10b981]/30 bg-[#10b981]/5' :
                      'border-[#E2E8F0]'
                    }`}>
                      {getTimelineIcon(event.type)}
                    </div>

                    {/* Log block */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-sans text-xs font-bold uppercase tracking-wide ${
                          event.type === 'error' ? 'text-[#ef4444]' :
                          event.type === 'decision' ? 'text-[#7c3aed]' :
                          event.type === 'fix' ? 'text-[#10b981]' :
                          'text-black'
                        }`}>
                          {event.title}
                        </span>
                        <span className="font-mono text-[10px] text-[#747878]">{event.timestamp}</span>
                      </div>

                      <p className="font-sans text-sm text-[#444748] leading-relaxed">
                        {event.description}
                      </p>

                      {/* EXPLAIN query outputs if analysis action has link */}
                      {event.extraLink && (
                        <button
                          onClick={() => setShowExplainModal(true)}
                          className="text-[#712ae2] hover:underline font-sans text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          {event.extraLink.label}
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Error payloads code snippets */}
                      {event.extraCode && (
                        <div className="bg-black text-[#eff1f3] p-3 rounded font-mono text-[11px] overflow-x-auto select-all leading-normal">
                          <code>{event.extraCode}</code>
                        </div>
                      )}

                      {/* Embedded File Attachments descriptors */}
                      {event.fileAttachment && (
                        <div className="bg-[#f7f9fb] border border-[#E2E8F0] p-3 rounded flex items-center gap-3">
                          <FileCode className="w-5 h-5 text-[#747878] shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="font-mono text-[11px] text-black block truncate font-medium">
                              {event.fileAttachment}
                            </span>
                          </div>
                          <span className="px-1.5 py-0.2 px-2 py-0.5 rounded bg-[#10b981]/10 text-[#10b981] font-mono text-[9px] font-bold">
                            ATTACHED
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right narrower column: Auxiliary state metadata */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          
          {/* Learned skills from this task completion */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden shadow-xs">
            <div className="border-b border-[#E2E8F0] bg-[#f2f4f6]/60 px-4 py-3 flex items-center justify-between">
              <h4 className="font-sans text-xs font-bold text-black uppercase tracking-wider">
                沉淀技能 (LEARNED SKILLS)
              </h4>
            </div>
            
            <div className="p-4 flex flex-col gap-3">
              {task.derivedSkills && task.derivedSkills.length > 0 ? (
                task.derivedSkills.map((skillName) => (
                  <div key={skillName} className="border border-[#E2E8F0] rounded p-3 hover:bg-[#f2f4f6]/50 transition-colors">
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="font-sans text-xs font-bold text-black">{skillName}</span>
                      <span className="font-mono text-[9px] text-[#10b981] bg-[#10b981]/10 px-1.5 py-0.5 rounded font-bold uppercase">
                        Learned
                      </span>
                    </div>
                    <p className="font-mono text-[10px] text-[#747878] truncate">
                      Signature: parse_pg_explain_json(data)
                    </p>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-[#747878] text-xs italic">
                  本执行周期尚未提炼新知识签名。
                </div>
              )}
            </div>
          </div>

          {/* Related System Failures referenced */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden shadow-xs">
            <div className="border-b border-[#E2E8F0] bg-[#f2f4f6]/60 px-4 py-3 flex items-center justify-between">
              <h4 className="font-sans text-xs font-bold text-black uppercase tracking-wider">
                相关故障模式
              </h4>
              <span className="font-mono text-[10px] text-[#747878]">Past 30d</span>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="border border-[#E2E8F0] rounded p-3">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-sans text-xs font-bold text-black">Timeout on User Analytics</span>
                  <span className="font-mono text-[9px] text-[#ef4444] bg-[#ef4444]/10 px-1.5 py-0.5 rounded font-bold uppercase">
                    ERR-92
                  </span>
                </div>
                <p className="font-sans text-xs leading-relaxed text-[#747878]">
                  Similar full-table scan pattern identified in analytics pipeline queries during high workloads.
                </p>
                <div className="mt-2.5 flex justify-end">
                  <button 
                    onClick={() => addToast('此条故障与当前 TSK-8924 Index Compound 优化相关，检测到相同的索引漏配置情况。已启动自动防御。', 'warning')}
                    className="text-[#7c3aed] font-sans text-xs font-bold hover:underline"
                  >
                    查看详情 &rarr;
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Embedded database execution outputs explain analytical details */}
      {showExplainModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-[#E2E8F0] w-full max-w-2xl max-h-[80%] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-[#E2E8F0]">
              <h3 className="font-sans text-sm font-bold text-black">EXPLAIN ANALYZE OUTPUT FOR FEED QUERY</h3>
              <button 
                onClick={() => setShowExplainModal(false)}
                className="text-[#747878] hover:text-black w-6 h-6 rounded flex items-center justify-center hover:bg-[#f2f4f6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 font-mono text-xs text-[#10b981] bg-black overflow-y-auto flex-1 leading-relaxed select-all">
              {`EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM activities 
WHERE user_id = 98124 AND created_at > '2026-06-05' 
ORDER BY created_at DESC LIMIT 20;

->  Sort (cost=45112.50..45231.20 rows=400 width=128) (actual time=245.122..245.135 rows=20 loops=1)
      Sort Key: created_at DESC
      Sort Method: top-N heapsort  Memory: 45kB
      Buffers: shared hit=14201 read=2105
      ->  Seq Scan on activities (cost=0.00..45080.00 rows=400 width=128) (actual time=0.088..232.404 rows=412 loops=1)
            Filter: ((user_id = 98124) AND (created_at > '2026-06-05'::timestamp))
            Rows Removed by Filter: 1420485
            Buffers: shared hit=14201 read=2105

Planning Time: 0.145 ms
Execution Time: 245.188 ms (CRITICAL WARNING: Sequential scanning detected on large table constraints!)`}
            </div>
            <div className="p-3 bg-[#f7f9fb] text-right border-t border-[#E2E8F0]">
              <button 
                onClick={() => setShowExplainModal(false)}
                className="px-4 py-1.5 bg-black text-white rounded font-sans text-xs font-semibold hover:opacity-90 transition-opacity"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
