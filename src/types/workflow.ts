/**
 * Workflow-related types for SRIntelligence.
 */

import type { PipelineDefinition } from './agent';

// ---------------------------------------------------------------------------
// Workflow parameters
// ---------------------------------------------------------------------------

export type WorkflowParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiselect';

export interface WorkflowParameter {
  key: string;
  label: string;
  type: WorkflowParameterType;
  required: boolean;
  defaultValue?: string | number | boolean | string[];
  /** For 'select' and 'multiselect' types */
  options?: Array<{ label: string; value: string }>;
  description?: string;
  /** Regex pattern for string validation */
  validationPattern?: string;
}

// ---------------------------------------------------------------------------
// Workflow record (persisted definition)
// ---------------------------------------------------------------------------

export type WorkflowStatus = 'draft' | 'active' | 'archived' | 'deprecated';
export type WorkflowCategory =
  | 'analytics'
  | 'forecasting'
  | 'clustering'
  | 'reporting'
  | 'custom';

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  category: WorkflowCategory;
  status: WorkflowStatus;
  ownerId: string;
  /** Team or org identifier, if shared */
  organizationId?: string;
  parameters: WorkflowParameter[];
  /** The canonical pipeline definition backing this workflow */
  pipelineDefinition: PipelineDefinition;
  /** Tags for search and filtering */
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** ISO-8601 date string of the last successful run */
  lastRunAt?: string;
  runCount: number;
}

// ---------------------------------------------------------------------------
// Workflow versioning
// ---------------------------------------------------------------------------

export interface WorkflowVersion {
  versionId: string;
  workflowId: string;
  versionNumber: number;
  /** Semver-style label, e.g. '1.0.0' */
  label: string;
  changelog: string;
  pipelineDefinitionSnapshot: PipelineDefinition;
  createdBy: string;
  createdAt: number;
  /** Whether this version is the one currently active for the workflow */
  isCurrent: boolean;
}

// ---------------------------------------------------------------------------
// Workflow sharing
// ---------------------------------------------------------------------------

export type SharePermission = 'view' | 'run' | 'edit' | 'admin';

export interface WorkflowShare {
  id: string;
  workflowId: string;
  /** User ID or group ID being granted access */
  granteeId: string;
  /** 'user' | 'group' */
  granteeType: 'user' | 'group';
  permission: SharePermission;
  grantedBy: string;
  grantedAt: number;
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// Workflow scheduling
// ---------------------------------------------------------------------------

export type ScheduleFrequency =
  | 'once'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'custom';

export interface WorkflowSchedule {
  id: string;
  workflowId: string;
  enabled: boolean;
  frequency: ScheduleFrequency;
  /** Cron expression — required when frequency is 'custom' */
  cronExpression?: string;
  /** IANA timezone string, e.g. 'America/New_York' */
  timezone: string;
  /** Parameter overrides applied at scheduled run time */
  parameterOverrides: Record<string, string | number | boolean | string[]>;
  /** User IDs to notify on completion or failure */
  notifyUserIds: string[];
  nextRunAt?: number;
  lastRunAt?: number;
  /** Snowflake user that owns the scheduled execution */
  runAsUserId?: string;
  /** Snowflake role used during scheduled execution */
  runAsRole?: string;
  /** When true, always pick the latest version at run time */
  useLatestVersion?: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Workflow execution record
// ---------------------------------------------------------------------------

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface StepExecutionRecord {
  stepId: string;
  agentName: string;
  status: ExecutionStatus;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
  retryCount: number;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  triggeredBy: 'user' | 'schedule' | 'api';
  triggeredByUserId: string;
  sessionId: string;
  status: ExecutionStatus;
  /** Resolved parameter values used for this execution */
  resolvedParameters: Record<string, string | number | boolean | string[]>;
  stepExecutions: StepExecutionRecord[];
  /** Lineage ID linking to the LineageRecord */
  lineageId: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
}
