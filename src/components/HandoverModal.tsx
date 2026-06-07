/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { X, History, Puzzle, AlertTriangle, Flag, Copy, FolderArchive, Download } from 'lucide-react';
import { Task } from '../types';

interface HandoverModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  addToast: (msg: string, type: 'info'|'success'|'warning'|'error') => void;
}

export default function HandoverModal({ task, isOpen, onClose, addToast }: HandoverModalProps) {
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [includeSkills, setIncludeSkills] = useState(true);
  const [includeFailures, setIncludeFailures] = useState(true);
  const [includeUnresolved, setIncludeUnresolved] = useState(true);

  if (!isOpen) return null;

  // Calculate size in MB based on active checkboxes
  let totalSize = 0.1; // Baseline metadata
  if (includeEvidence) totalSize += 0.6;
  if (includeSkills) totalSize += 0.2;
  if (includeFailures) totalSize += 0.25;
  if (includeUnresolved) totalSize += 0.05;

  // Build the dynamic prompt text
  const getPromptText = () => {
    let text = `SYSTEM: Act as an expert AI agent debugger. I am handing over context for a partially complete task: "${task.title}".\n\n`;
    text += `CONTEXT SUMMARY:\n`;
    text += `- Current State: Active in-progress tracking for task ID [${task.id}]\n`;
    text += `- Task Priority: ${task.priority}\n`;
    
    if (includeEvidence) {
      text += `- Executed Nodes: ${task.timeline ? task.timeline.length * 8 : 42}\n`;
    }
    if (includeSkills) {
      const skillsText = task.derivedSkills ? task.derivedSkills.join(', ') : 'JSON Parser (v1.2), Auth Validator (v2.0)';
      text += `- Invoked Skills: ${skillsText}\n`;
    }
    if (includeFailures) {
      text += `- Recorded Failures: 1 (Retry limit hit on diagnostic endpoint)\n`;
    }
    text += `\nINSTRUCTIONS:\n`;
    text += `Review the attached evidence chain and context payload, identify any core database scan patterns or memory optimization vulnerabilities, and propose a hotfix utilizing standard schemas.\n\n`;
    
    text += `ATTACHMENTS INCLUDED:\n`;
    if (includeEvidence) text += `- evidence_chain.json (Timeline and actions logs)\n`;
    if (includeSkills) text += `- skills_manifest.json (Skill definitions)\n`;
    if (includeFailures) text += `- failure_trace_diagnostic.log (Stack traces and diagnostic signatures)\n`;
    if (includeUnresolved) text += `- unresolved_issues.md (Unresolved threads and active caveats)\n`;

    return text;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getPromptText());
    addToast('导出的 Prompt 预览已成功复制到剪贴板！', 'success');
  };

  const handleExportZip = () => {
    const payload = {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        description: task.description,
        priority: task.priority,
        agentName: task.agentName
      },
      exportConfig: {
        includeEvidence,
        includeSkills,
        includeFailures,
        includeUnresolved
      },
      evidenceChain: includeEvidence ? task.timeline : null,
      skills: includeSkills ? task.derivedSkills : null,
      prompt: getPromptText(),
      exportedAt: new Date().toISOString()
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `AEL_Handover_${task.id || 'GLOBAL'}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    addToast(`接手程序包制作完成。正在下载 ${task.id || '全局'} 接手协议包。`, 'info');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div 
        className="bg-white rounded-xl border border-[#E2E8F0] w-full max-w-3xl flex flex-col max-h-[92%] overflow-hidden"
        style={{ boxShadow: '0px 20px 25px -5px rgba(0,0,0,0.1)' }}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#E2E8F0]">
          <div>
            <h2 className="font-sans text-lg font-bold text-black mb-1">导出接手包</h2>
            <p className="font-sans text-xs text-[#747878]">配置要包含在接手 zip 中的上下文和证据。</p>
          </div>
          <button 
            onClick={onClose}
            className="text-[#747878] hover:text-black transition-colors flex items-center justify-center w-8 h-8 rounded hover:bg-[#f2f4f6]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col md:flex-row gap-8">
          
          {/* Left Column: Criteria Selection */}
          <div className="flex-1 flex flex-col gap-6">
            <h3 className="font-sans text-[11px] font-semibold text-[#747878] uppercase tracking-wider">包含标准</h3>
            
            <div className="flex flex-col gap-3">
              {/* Criteria item 1 */}
              <label className={`flex items-start gap-3 p-3 border rounded transition-all cursor-pointer ${
                includeEvidence ? 'bg-[#f2f4f6]/50 border-black' : 'border-[#E2E8F0] hover:bg-[#f2f4f6]'
              }`}>
                <div className="mt-0.5">
                  <input 
                    type="checkbox" 
                    checked={includeEvidence} 
                    onChange={(e) => setIncludeEvidence(e.target.checked)}
                    className="w-4 h-4 rounded text-black border-[#747878] focus:ring-black accent-black"
                  />
                </div>
                <div className="flex-1">
                  <div className="font-sans text-sm font-semibold text-black">证据链</div>
                  <div className="font-sans text-xs text-[#747878] mt-0.5 leading-relaxed">
                    包含 {task.timeline ? task.timeline.length : 5} 个执行日志、3 个决策节点以及完整的 stdout/stderr 跟踪。
                  </div>
                </div>
                <History className="w-4 h-4 text-[#747878] shrink-0" />
              </label>

              {/* Criteria item 2 */}
              <label className={`flex items-start gap-3 p-3 border rounded transition-all cursor-pointer ${
                includeSkills ? 'bg-[#f2f4f6]/50 border-black' : 'border-[#E2E8F0] hover:bg-[#f2f4f6]'
              }`}>
                <div className="mt-0.5">
                  <input 
                    type="checkbox" 
                    checked={includeSkills} 
                    onChange={(e) => setIncludeSkills(e.target.checked)}
                    className="w-4 h-4 rounded text-black border-[#747878] focus:ring-black accent-black"
                  />
                </div>
                <div className="flex-1">
                  <div className="font-sans text-sm font-semibold text-black">相关技能</div>
                  <div className="font-sans text-xs text-[#747878] mt-0.5 leading-relaxed">
                    捆绑 2 个调用技能（{task.derivedSkills && task.derivedSkills.length > 0 ? task.derivedSkills.join('、') : 'PostgreSQL Explain'}）的签名和小尺度实现细节。
                  </div>
                </div>
                <Puzzle className="w-4 h-4 text-[#747878] shrink-0" />
              </label>

              {/* Criteria item 3 */}
              <label className={`flex items-start gap-3 p-3 border rounded transition-all cursor-pointer ${
                includeFailures ? 'bg-[#f2f4f6]/50 border-black' : 'border-[#E2E8F0] hover:bg-[#f2f4f6]'
              }`}>
                <div className="mt-0.5">
                  <input 
                    type="checkbox" 
                    checked={includeFailures} 
                    onChange={(e) => setIncludeFailures(e.target.checked)}
                    className="w-4 h-4 rounded text-black border-[#747878] focus:ring-black accent-black"
                  />
                </div>
                <div className="flex-1">
                  <div className="font-sans text-sm font-semibold text-black">相关失败</div>
                  <div className="font-sans text-xs text-[#747878] mt-0.5 leading-relaxed">
                    包含此任务范围内 1 个重试事件的精细化堆栈跟踪和内存快照。
                  </div>
                </div>
                <AlertTriangle className="w-4 h-4 text-[#ef4444] shrink-0" />
              </label>

              {/* Criteria item 4 */}
              <label className={`flex items-start gap-3 p-3 border rounded transition-all cursor-pointer ${
                includeUnresolved ? 'bg-[#f2f4f6]/50 border-black' : 'border-[#E2E8F0] hover:bg-[#f2f4f6]'
              }`}>
                <div className="mt-0.5">
                  <input 
                    type="checkbox" 
                    checked={includeUnresolved} 
                    onChange={(e) => setIncludeUnresolved(e.target.checked)}
                    className="w-4 h-4 rounded text-black border-[#747878] focus:ring-black accent-black"
                  />
                </div>
                <div className="flex-1">
                  <div className="font-sans text-sm font-semibold text-black">未解决的问题</div>
                  <div className="font-sans text-xs text-[#747878] mt-0.5 leading-relaxed">
                    附加当前执行周期中确定的外部依赖以及未解决的空线程。
                  </div>
                </div>
                <Flag className="w-4 h-4 text-[#747878] shrink-0" />
              </label>
            </div>
          </div>

          {/* Right Column: Prompt Preview */}
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-sans text-[11px] font-semibold text-[#747878] uppercase tracking-wider">生成的 Prompt 预览</h3>
              <button 
                onClick={handleCopy}
                className="text-xs text-[#444748] hover:text-black flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5 text-[#747878]" /> 
                复制
              </button>
            </div>

            <div className="flex-1 bg-[#f2f4f6] border border-[#E2E8F0] rounded p-4 font-mono text-xs text-black overflow-y-auto whitespace-pre-wrap leading-relaxed max-h-[340px]">
              {getPromptText()}
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[#E2E8F0] bg-[#f7f9fb] flex justify-between items-center rounded-b-xl">
          <div className="font-mono text-xs text-[#747878] flex items-center gap-2">
            <FolderArchive className="w-4 h-4 text-[#747878]" />
            预计大小: ~{totalSize.toFixed(2)} MB
          </div>

          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="px-4 py-2 border border-[#E2E8F0] rounded font-sans text-xs font-semibold text-black hover:bg-[#f2f4f6] transition-colors"
            >
              取消
            </button>
            <button 
              onClick={handleExportZip}
              className="px-4 py-2 bg-black text-white rounded font-sans text-xs font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Download className="w-4 h-4 text-white" />
              导出 handover.zip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
