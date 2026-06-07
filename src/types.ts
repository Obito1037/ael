/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TaskStatus = 'in_progress' | 'blocked' | 'pending' | 'verified';

export type SkillStatus = 'active' | 'draft' | 'deprecated';

export type FailureStatus = 'active' | 'configured' | 'logged';

export type EventType = 'analysis' | 'error' | 'decision' | 'fix' | 'verification';

export interface TimelineEvent {
  id: string;
  type: EventType;
  title: string;
  timestamp: string;
  description: string;
  extraCode?: string;
  extraLink?: { label: string; url: string };
  fileAttachment?: string;
}

export interface Task {
  id: string; // e.g., TSK-8924
  title: string;
  status: TaskStatus;
  description: string;
  agentName: string;
  priority: 'High' | 'Medium' | 'Low';
  tags: string[];
  updateTimeAgo: string; // e.g., "2 minutes ago"
  timeElapsed?: string; // e.g., "02h 45m 12s"
  timeline?: TimelineEvent[];
  derivedSkills?: string[]; // skill ids learned or utilized
  relatedFailuresRef?: string[]; // failure modes referenced
}

export interface Skill {
  id: string;
  name: string;
  status: SkillStatus;
  trigger: string;
  successCount: number | '-';
  failureCount: number | '-';
  tags: string[];
}

export interface FailureDefense {
  id: string;
  name: string;
  status: FailureStatus;
  occurrences: number;
  description: string;
  errorSignature: string;
  repairMethod: string;
  constraint: string;
  autoRepairActive: boolean;
  upcomingAlertConfigured?: boolean;
}
