/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, Skill, FailureDefense } from './types';

export const INITIAL_SKILLS: Skill[] = [
  {
    id: 'skill-1',
    name: 'FetchUserData',
    status: 'active',
    trigger: 'event.type == "user.login"',
    successCount: 14203,
    failureCount: 12,
    tags: ['core', 'auth']
  },
  {
    id: 'skill-2',
    name: 'SyncInventoryDB',
    status: 'draft',
    trigger: 'cron("0 0 * * *")',
    successCount: '-',
    failureCount: '-',
    tags: ['data', 'nightly']
  },
  {
    id: 'skill-3',
    name: 'SendLegacyEmail',
    status: 'deprecated',
    trigger: 'manual_invocation',
    successCount: 89012,
    failureCount: 405,
    tags: ['comms', 'legacy']
  }
];

export const INITIAL_FAILURES: FailureDefense[] = [
  {
    id: 'fail-1',
    name: 'LLM 服务超时',
    status: 'active',
    occurrences: 1204,
    description: '底层基础模型 API 在生成阶段未能在配置的超时窗口内响应。',
    errorSignature: 'httpx.ReadTimeout: The read operation timed out',
    repairMethod: '指数退避 + 重试',
    constraint: '最多重试 3 次/小时',
    autoRepairActive: true
  },
  {
    id: 'fail-2',
    name: '输出模式不匹配',
    status: 'configured',
    occurrences: 89,
    description: '代理生成的 JSON 输出违反了为任务输出要求定义的严格 JSON 模式。',
    errorSignature: 'pydantic.ValidationError: 1 validation error for OutputFormat',
    repairMethod: '带错误重新提示',
    constraint: '在提示中提供模式',
    autoRepairActive: true,
    upcomingAlertConfigured: true
  },
  {
    id: 'fail-3',
    name: 'Token 限制超限',
    status: 'logged',
    occurrences: 412,
    description: '输入负载加上生成超出了模型允许的最大上下文窗口。不截断则无法继续任务。',
    errorSignature: "BadRequestError: This model's maximum context length is 128000 tokens.",
    repairMethod: '未定义',
    constraint: '无',
    autoRepairActive: false
  }
];

export const INITIAL_TASKS: Task[] = [
  {
    id: 'TSK-8924',
    title: 'Optimize Database Queries for User Feed',
    status: 'in_progress',
    description: 'Analyze slow-performing queries in the main activity feed endpoint, refactor indexing strategy, and verify performance improvements under simulated load.',
    agentName: 'Optimizer-V4',
    priority: 'High',
    tags: ['Backend', 'DB'],
    updateTimeAgo: 'Just now',
    timeElapsed: '02h 45m 12s',
    derivedSkills: ['PostgreSQL Explain Parsing'],
    relatedFailuresRef: ['fail-3'],
    timeline: [
      {
        id: 'ev-1',
        type: 'analysis',
        title: '分析步骤',
        timestamp: '10:42 AM',
        description: 'Executed EXPLAIN ANALYZE on primary feed query.',
        extraLink: { label: '查看执行计划输出', url: '#' }
      },
      {
        id: 'ev-2',
        type: 'error',
        title: '检测到错误',
        timestamp: '10:45 AM',
        description: "Index missing on 'created_at' and 'user_id' compound. Query scanning full table.",
        extraCode: 'Seq Scan on activities (cost=0.00..45231.20 rows=400 width=128)'
      },
      {
        id: 'ev-3',
        type: 'decision',
        title: '决策点',
        timestamp: '10:50 AM',
        description: 'Chosen action: Create a composite index rather than restructuring the query logic to maintain backwards compatibility with older clients.'
      },
      {
        id: 'ev-4',
        type: 'fix',
        title: '实施',
        timestamp: '11:15 AM',
        description: 'Applied composite index migration.',
        fileAttachment: 'migration_20231025_add_feed_idx.sql'
      },
      {
        id: 'ev-5',
        type: 'verification',
        title: '验证负载',
        timestamp: 'Active',
        description: 'Running k6 simulated load test against staging environment...'
      }
    ]
  },
  {
    id: 'TSK-8921',
    title: '数据摄取管道重构',
    status: 'in_progress',
    description: '优化主 Kafka 消费者组以处理来自上游分析服务的全新 JSON 有效负载结构。通过实施对 Postgres 的批量插入来减少处理延迟。',
    agentName: 'Agent-Alpha',
    priority: 'High',
    tags: ['Data', 'Ingest'],
    updateTimeAgo: '2 分钟前'
  },
  {
    id: 'TSK-8919',
    title: 'Stripe API 集成验证',
    status: 'blocked',
    description: '在测试环境中验证新的 webhook 签名。目前由于 staging vault 中缺少密钥而失败。等待人工干预注入凭据。',
    agentName: 'Agent-Beta',
    priority: 'High',
    tags: ['Integration', 'Stripe'],
    updateTimeAgo: '15 分钟前'
  },
  {
    id: 'TSK-8925',
    title: '生成第三季度合规报告',
    status: 'pending',
    description: '将过去一个季度的系统访问日志和权限更改编译到标准 PDF 模板中，供合规审计团队使用。',
    agentName: '未分配',
    priority: 'Medium',
    tags: ['Compliance', 'PDF'],
    updateTimeAgo: '1 小时前'
  },
  {
    id: 'TSK-8915',
    title: '更新 React Router 依赖项',
    status: 'verified',
    description: '将应用程序路由迁移到 v6 语法并验证所有 e2e 测试通过。',
    agentName: 'Agent-Gamma',
    priority: 'Low',
    tags: ['Frontend', 'Refactor'],
    updateTimeAgo: '3 小时前'
  }
];
