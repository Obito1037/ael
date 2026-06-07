/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { X, Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

export interface ToastData {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface ToastProps {
  toasts: ToastData[];
  removeToast: (id: string) => void;
}

export default function ToastContainer({ toasts, removeToast }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map(toast => (
        <div 
          key={toast.id} 
          className="bg-white border border-[#E2E8F0] shadow-[0_8px_30px_rgb(0,0,0,0.12)] text-black px-4 py-3 rounded-lg flex items-start gap-3 min-w-[320px] max-w-[400px] animate-fade-in pointer-events-auto"
        >
          <div className="mt-0.5 shrink-0">
            {toast.type === 'info' && <Info className="w-5 h-5 text-[#3b82f6]" />}
            {toast.type === 'success' && <CheckCircle className="w-5 h-5 text-[#10b981]" />}
            {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-[#f59e0b]" />}
            {toast.type === 'error' && <XCircle className="w-5 h-5 text-[#ef4444]" />}
          </div>
          <span className="font-sans text-sm flex-1 leading-relaxed text-[#191c1e]">{toast.message}</span>
          <button 
            onClick={() => removeToast(toast.id)} 
            className="text-[#747878] hover:text-black transition-colors shrink-0 p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
