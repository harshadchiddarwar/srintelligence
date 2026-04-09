/**
 * WorkflowService — full CRUD, sharing, versioning, scheduling, and execution
 * history for SRIntelligence workflows.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  WorkflowRecord,
  WorkflowVersion,
  WorkflowShare,
  WorkflowSchedule,
  WorkflowExecution,
  WorkflowStatus,
  WorkflowCategory,
  SharePermission,
  ExecutionStatus,
} from '../../types/workflow';
import type { PipelineDefinition } from '../../types/agent';
import { executeSQL } from '../snowflake/sql-api';

// ---------------------------------------------------------------------------
// WorkflowService
// ---------------------------------------------------------------------------

export class WorkflowService {
  // ---------------------------------------------------------------------------
  // List / Get
  // ---------------------------------------------------------------------------

  async listWorkflows(params: {
    userId: string;
    userRole: string;
    filter?: { category?: WorkflowCategory; status?: WorkflowStatus; search?: string };
    sort?: 'name' | 'updatedAt' | 'runCount';
    limit?: number;
    offset?: number;
  }): Promise<WorkflowRecord[]> {
    const conditions: string[] = [];
    conditions.push(
      `(owner_id = '${params.userId}' OR is_public = TRUE OR EXISTS (
        SELECT 1 FROM CORTEX_TESTING.PUBLIC.WORKFLOW_SHARES ws
        WHERE ws.workflow_id = w.workflow_id
          AND (ws.grantee_id = '${params.userId}' OR ws.grantee_id = '${params.userRole}')
          AND (ws.expires_at IS NULL OR ws.expires_at > CURRENT_TIMESTAMP())
      ))`,
    );

    if (params.filter?.category) {
      conditions.push(`category = '${params.filter.category}'`);
    }
    if (params.filter?.status) {
      conditions.push(`status = '${params.filter.status}'`);
    } else {
      conditions.push(`status != 'archived'`);
    }
    if (params.filter?.search) {
      const s = params.filter.search.replace(/'/g, "\\'");
      conditions.push(`(name ILIKE '%${s}%' OR description ILIKE '%${s}%')`);
    }

    const orderBy = {
      name: 'name ASC',
      updatedAt: 'updated_at DESC',
      runCount: 'run_count DESC',
    }[params.sort ?? 'updatedAt'];

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const sql = `
      SELECT * FROM CORTEX_TESTING.PUBLIC.WORKFLOWS w
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `;

    try {
      const result = await executeSQL(sql, params.userRole);
      return result.rows.map((r) => this.rowToRecord(r as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  async getWorkflow(
    params: { workflowId: string; userId: string; userRole?: string },
  ): Promise<WorkflowRecord | null> {
    const userRole = params.userRole ?? 'APP_SVC_ROLE';
    try {
      const result = await executeSQL(
        `SELECT * FROM CORTEX_TESTING.PUBLIC.WORKFLOWS WHERE workflow_id = '${params.workflowId}' LIMIT 1`,
        userRole,
      );
      if (result.rowCount === 0) return null;
      return this.rowToRecord(result.rows[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async createWorkflow(
    input: {
      name: string;
      description?: string;
      icon?: string;
      category?: WorkflowCategory;
      tags?: string[];
      pipelineDefinition: PipelineDefinition;
      primarySemanticViewId?: string;
      isTemplate?: boolean;
      isPublic?: boolean;
      /** Convenience: caller can embed ownerId + userRole directly in input */
      ownerId?: string;
      userRole?: string;
    },
    userId?: string,
  ): Promise<WorkflowRecord> {
    const resolvedUserId = userId ?? input.ownerId ?? 'system';
    const workflowId = uuidv4();
    const versionId = uuidv4();
    const now = Date.now();

    const pipelineJson = JSON.stringify(input.pipelineDefinition).replace(/'/g, "\\'");
    const tagsJson = JSON.stringify(input.tags ?? []).replace(/'/g, "\\'");

    await executeSQL(`
      INSERT INTO CORTEX_TESTING.PUBLIC.WORKFLOWS (
        workflow_id, name, description, icon, category, status,
        owner_id, is_template, is_public, tags,
        primary_semantic_view_id, pipeline_definition,
        current_version_id, run_count, created_at, updated_at
      ) VALUES (
        '${workflowId}',
        '${(input.name).replace(/'/g, "\\'")}',
        '${(input.description ?? '').replace(/'/g, "\\'")}',
        '${(input.icon ?? '').replace(/'/g, "\\'")}',
        '${input.category ?? 'custom'}',
        'draft',
        '${resolvedUserId}',
        ${input.isTemplate ? 'TRUE' : 'FALSE'},
        ${input.isPublic ? 'TRUE' : 'FALSE'},
        PARSE_JSON('${tagsJson}'),
        ${input.primarySemanticViewId ? `'${input.primarySemanticViewId}'` : 'NULL'},
        PARSE_JSON('${pipelineJson}'),
        '${versionId}',
        0,
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
      )
    `);

    // Insert first version
    await executeSQL(`
      INSERT INTO CORTEX_TESTING.PUBLIC.WORKFLOW_VERSIONS (
        version_id, workflow_id, version_number, label,
        changelog, pipeline_definition_snapshot,
        created_by, is_current, created_at
      ) VALUES (
        '${versionId}',
        '${workflowId}',
        1,
        '1.0.0',
        'Initial version',
        PARSE_JSON('${pipelineJson}'),
        '${resolvedUserId}',
        TRUE,
        CURRENT_TIMESTAMP()
      )
    `);

    const record: WorkflowRecord = {
      id: workflowId,
      name: input.name,
      description: input.description ?? '',
      category: input.category ?? 'custom',
      status: 'draft',
      ownerId: resolvedUserId,
      parameters: [],
      pipelineDefinition: input.pipelineDefinition,
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    };

    return record;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  async updateWorkflow(params: {
    workflowId: string;
    userId: string;
    userRole?: string;
    updates?: Partial<Pick<WorkflowRecord, 'name' | 'description' | 'category' | 'status' | 'tags'>>;
    newPipelineDefinition?: PipelineDefinition;
    // Allow update fields to be passed directly (flattened from routes)
    name?: string;
    description?: string;
    pipelineDefinition?: PipelineDefinition;
    tags?: string[];
  }): Promise<WorkflowRecord> {
    // Merge flattened fields into updates object
    const updates = params.updates ?? {
      name: params.name,
      description: params.description,
      tags: params.tags,
    };
    const newPipelineDefinition = params.pipelineDefinition ?? params.newPipelineDefinition;

    const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP()'];

    if (updates.name) {
      setClauses.push(`name = '${updates.name.replace(/'/g, "\\'")}'`);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = '${updates.description.replace(/'/g, "\\'")}'`);
    }
    if (updates.category) {
      setClauses.push(`category = '${updates.category}'`);
    }
    if (updates.status) {
      setClauses.push(`status = '${updates.status}'`);
    }
    if (updates.tags) {
      const tagsJson = JSON.stringify(updates.tags).replace(/'/g, "\\'");
      setClauses.push(`tags = PARSE_JSON('${tagsJson}')`);
    }

    if (newPipelineDefinition) {
      const pipelineJson = JSON.stringify(newPipelineDefinition).replace(/'/g, "\\'");
      setClauses.push(`pipeline_definition = PARSE_JSON('${pipelineJson}')`);

      // Create a new version
      const versionId = uuidv4();
      await executeSQL(`
        UPDATE CORTEX_TESTING.PUBLIC.WORKFLOW_VERSIONS
        SET is_current = FALSE
        WHERE workflow_id = '${params.workflowId}'
      `);
      const versionCount = await executeSQL(`
        SELECT COUNT(*) AS cnt FROM CORTEX_TESTING.PUBLIC.WORKFLOW_VERSIONS
        WHERE workflow_id = '${params.workflowId}'
      `);
      const nextVersion = Number(
        ((versionCount.rows[0] as Record<string, unknown>)['CNT'] ?? 0),
      ) + 1;

      await executeSQL(`
        INSERT INTO CORTEX_TESTING.PUBLIC.WORKFLOW_VERSIONS (
          version_id, workflow_id, version_number, label,
          changelog, pipeline_definition_snapshot,
          created_by, is_current, created_at
        ) VALUES (
          '${versionId}',
          '${params.workflowId}',
          ${nextVersion},
          '${nextVersion}.0.0',
          'Updated pipeline definition',
          PARSE_JSON('${pipelineJson}'),
          '${params.userId}',
          TRUE,
          CURRENT_TIMESTAMP()
        )
      `);
      setClauses.push(`current_version_id = '${versionId}'`);
    }

    await executeSQL(`
      UPDATE CORTEX_TESTING.PUBLIC.WORKFLOWS
      SET ${setClauses.join(', ')}
      WHERE workflow_id = '${params.workflowId}'
    `);

    const updated = await this.getWorkflow({ workflowId: params.workflowId, userId: params.userId, userRole: params.userRole ?? 'ANALYST' });
    if (!updated) throw new Error(`Workflow ${params.workflowId} not found after update.`);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Fork
  // ---------------------------------------------------------------------------

  async forkWorkflow(params: {
    workflowId: string;
    newName?: string;
    name?: string;
    userId?: string;
    newOwnerId?: string;
    userRole?: string;
  }): Promise<WorkflowRecord> {
    const resolvedName = params.newName ?? params.name ?? 'Forked Workflow';
    const resolvedUserId = params.userId ?? params.newOwnerId ?? 'system';
    const source = await this.getWorkflow({ workflowId: params.workflowId, userId: resolvedUserId, userRole: params.userRole });
    if (!source) throw new Error(`Workflow ${params.workflowId} not found.`);

    const forked = await this.createWorkflow(
      {
        name: resolvedName,
        description: `Forked from: ${source.name}`,
        category: source.category,
        tags: [...source.tags, 'forked'],
        pipelineDefinition: source.pipelineDefinition,
      },
      resolvedUserId,
    );

    return forked;
  }

  // ---------------------------------------------------------------------------
  // Archive
  // ---------------------------------------------------------------------------

  async archiveWorkflow(params: { workflowId: string; userId: string; userRole?: string }): Promise<void> {
    await executeSQL(`
      UPDATE CORTEX_TESTING.PUBLIC.WORKFLOWS
      SET status = 'archived', updated_at = CURRENT_TIMESTAMP()
      WHERE workflow_id = '${params.workflowId}' AND owner_id = '${params.userId}'
    `);
  }

  // ---------------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------------

  async shareWorkflow(
    input: {
      workflowId: string;
      sharedWithUserId?: string;
      sharedWithRole?: string;
      permission: SharePermission;
    },
    grantedBy: string,
  ): Promise<WorkflowShare> {
    const shareId = uuidv4();
    const granteeId = input.sharedWithUserId ?? input.sharedWithRole ?? '';
    const granteeType = input.sharedWithUserId ? 'user' : 'group';

    await executeSQL(`
      INSERT INTO CORTEX_TESTING.PUBLIC.WORKFLOW_SHARES (
        share_id, workflow_id, grantee_id, grantee_type,
        permission, granted_by, granted_at
      ) VALUES (
        '${shareId}',
        '${input.workflowId}',
        '${granteeId}',
        '${granteeType}',
        '${input.permission}',
        '${grantedBy}',
        CURRENT_TIMESTAMP()
      )
    `);

    return {
      id: shareId,
      workflowId: input.workflowId,
      granteeId,
      granteeType,
      permission: input.permission,
      grantedBy,
      grantedAt: Date.now(),
    };
  }

  async revokeShare(shareId: string, revokedBy: string): Promise<void> {
    await executeSQL(`
      UPDATE CORTEX_TESTING.PUBLIC.WORKFLOW_SHARES
      SET revoked_by = '${revokedBy}', revoked_at = CURRENT_TIMESTAMP()
      WHERE share_id = '${shareId}'
    `);
  }

  async checkPermission(
    workflowId: string,
    userId: string,
    userRole: string,
  ): Promise<'owner' | 'admin' | 'editor' | 'runner' | 'viewer' | null> {
    try {
      const result = await executeSQL(`
        SELECT owner_id, is_public FROM CORTEX_TESTING.PUBLIC.WORKFLOWS
        WHERE workflow_id = '${workflowId}' LIMIT 1
      `);
      if (result.rowCount === 0) return null;

      const row = result.rows[0] as Record<string, unknown>;
      if (row['OWNER_ID'] === userId) return 'owner';

      const shareResult = await executeSQL(`
        SELECT permission FROM CORTEX_TESTING.PUBLIC.WORKFLOW_SHARES
        WHERE workflow_id = '${workflowId}'
          AND (grantee_id = '${userId}' OR grantee_id = '${userRole}')
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP())
          AND revoked_at IS NULL
        ORDER BY
          CASE permission
            WHEN 'admin' THEN 1
            WHEN 'edit' THEN 2
            WHEN 'run' THEN 3
            WHEN 'view' THEN 4
            ELSE 5
          END
        LIMIT 1
      `);

      if (shareResult.rowCount > 0) {
        const perm = String(
          (shareResult.rows[0] as Record<string, unknown>)['PERMISSION'] ?? '',
        );
        const map: Record<string, 'admin' | 'editor' | 'runner' | 'viewer'> = {
          admin: 'admin',
          edit: 'editor',
          run: 'runner',
          view: 'viewer',
        };
        return map[perm] ?? 'viewer';
      }

      if (row['IS_PUBLIC']) return 'viewer';
      return null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  async scheduleWorkflow(
    input: {
      workflowId: string;
      cronExpression: string;
      timezone: string;
      runAsUserId: string;
      runAsRole: string;
      useLatestVersion: boolean;
      notifyOnSuccess: boolean;
      notifyOnFailure: boolean;
      notificationEmails: string[];
    },
    userId: string,
  ): Promise<WorkflowSchedule> {
    const scheduleId = uuidv4();
    const emailsJson = JSON.stringify(input.notificationEmails).replace(/'/g, "\\'");

    await executeSQL(`
      INSERT INTO CORTEX_TESTING.PUBLIC.WORKFLOW_SCHEDULES (
        schedule_id, workflow_id, enabled, cron_expression, timezone,
        run_as_user_id, run_as_role, use_latest_version,
        notify_on_success, notify_on_failure, notification_emails,
        created_by, created_at, updated_at
      ) VALUES (
        '${scheduleId}',
        '${input.workflowId}',
        TRUE,
        '${input.cronExpression}',
        '${input.timezone}',
        '${input.runAsUserId}',
        '${input.runAsRole}',
        ${input.useLatestVersion ? 'TRUE' : 'FALSE'},
        ${input.notifyOnSuccess ? 'TRUE' : 'FALSE'},
        ${input.notifyOnFailure ? 'TRUE' : 'FALSE'},
        PARSE_JSON('${emailsJson}'),
        '${userId}',
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
      )
    `);

    const now = Date.now();
    const schedule: WorkflowSchedule = {
      id: scheduleId,
      workflowId: input.workflowId,
      enabled: true,
      frequency: 'custom',
      cronExpression: input.cronExpression,
      timezone: input.timezone,
      parameterOverrides: {},
      notifyUserIds: [],
      runAsUserId: input.runAsUserId,
      runAsRole: input.runAsRole,
      useLatestVersion: input.useLatestVersion,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    return schedule;
  }

  // ---------------------------------------------------------------------------
  // Execution tracking
  // ---------------------------------------------------------------------------

  async recordExecutionStart(params: {
    workflowId: string;
    /** ID to use; if omitted a new UUID is generated */
    executionId?: string;
    /** Version ID or alias (e.g. "current") */
    versionId?: string;
    workflowVersionId?: string;
    /** Trigger type */
    triggerType?: 'user' | 'schedule' | 'api';
    triggeredBy?: string;
    triggeredByUserId?: string;
    sessionId?: string;
    resolvedParameters?: Record<string, unknown>;
    totalSteps?: number;
  }): Promise<string> {
    const executionId = params.executionId ?? uuidv4();
    const sessionId = params.sessionId ?? uuidv4();
    const versionId = params.workflowVersionId ?? params.versionId ?? 'current';
    const triggerType = params.triggerType ?? 'user';
    const triggeredByUserId = params.triggeredByUserId ?? params.triggeredBy ?? 'system';
    const totalSteps = params.totalSteps ?? 0;

    try {
      await executeSQL(`
        INSERT INTO CORTEX_TESTING.PUBLIC.WORKFLOW_EXECUTIONS (
          execution_id, workflow_id, workflow_version_id,
          triggered_by, triggered_by_user_id, session_id,
          status, total_steps, completed_steps, failed_steps,
          started_at
        ) VALUES (
          '${executionId}',
          '${params.workflowId}',
          '${versionId}',
          '${triggerType}',
          '${triggeredByUserId}',
          '${sessionId}',
          'running',
          ${totalSteps},
          0,
          0,
          CURRENT_TIMESTAMP()
        )
      `);
    } catch {
      // non-blocking — execution tracking should not break the main flow
    }

    return executionId;
  }

  async recordExecutionComplete(params: {
    executionId: string;
    status: ExecutionStatus;
    completedSteps?: number;
    failedSteps?: number;
    finalNarrative?: string;
    /** Alias for errorMessage */
    error?: string;
    errorMessage?: string;
    stepResults?: unknown;
    totalCreditsConsumed?: number;
    lineageIds?: string[];
  }): Promise<void> {
    const narrativeEscaped = (params.finalNarrative ?? '').replace(/'/g, "\\'");
    const errorEscaped = (params.error ?? params.errorMessage ?? '').replace(/'/g, "\\'");
    const stepResultsJson = JSON.stringify(params.stepResults ?? {}).replace(/'/g, "\\'");
    const lineageJson = JSON.stringify(params.lineageIds ?? []).replace(/'/g, "\\'");

    await executeSQL(`
      UPDATE CORTEX_TESTING.PUBLIC.WORKFLOW_EXECUTIONS
      SET
        status = '${params.status}',
        completed_steps = ${params.completedSteps ?? 0},
        failed_steps = ${params.failedSteps ?? 0},
        final_narrative = '${narrativeEscaped}',
        error_message = '${errorEscaped}',
        step_results = PARSE_JSON('${stepResultsJson}'),
        total_credits_consumed = ${params.totalCreditsConsumed ?? 'NULL'},
        lineage_ids = PARSE_JSON('${lineageJson}'),
        completed_at = CURRENT_TIMESTAMP()
      WHERE execution_id = '${params.executionId}'
    `);

    if (params.status === 'success') {
      await executeSQL(`
        UPDATE CORTEX_TESTING.PUBLIC.WORKFLOWS
        SET run_count = run_count + 1, last_run_at = CURRENT_TIMESTAMP()
        WHERE workflow_id = (
          SELECT workflow_id FROM CORTEX_TESTING.PUBLIC.WORKFLOW_EXECUTIONS
          WHERE execution_id = '${params.executionId}'
        )
      `);
    }
  }

  async getExecutionHistory(params: {
    workflowId: string;
    userId: string;
    userRole?: string;
    limit?: number;
    offset?: number;
  }): Promise<WorkflowExecution[]> {
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;

    try {
      const result = await executeSQL(`
        SELECT * FROM CORTEX_TESTING.PUBLIC.WORKFLOW_EXECUTIONS
        WHERE workflow_id = '${params.workflowId}'
        ORDER BY started_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      return result.rows.map((r) => this.rowToExecution(r as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  async getExecution(executionId: string, _userId: string): Promise<WorkflowExecution | null> {
    try {
      const result = await executeSQL(`
        SELECT * FROM CORTEX_TESTING.PUBLIC.WORKFLOW_EXECUTIONS
        WHERE execution_id = '${executionId}' LIMIT 1
      `);
      if (result.rowCount === 0) return null;
      return this.rowToExecution(result.rows[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Versions
  // ---------------------------------------------------------------------------

  async listVersions(params: {
    workflowId: string;
    userId: string;
    userRole?: string;
  }): Promise<WorkflowVersion[]> {
    try {
      const result = await executeSQL(`
        SELECT * FROM CORTEX_TESTING.PUBLIC.WORKFLOW_VERSIONS
        WHERE workflow_id = '${params.workflowId}'
        ORDER BY version_number DESC
      `);
      return result.rows.map((r) => this.rowToVersion(r as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  async getVersion(params: {
    workflowId: string;
    versionId: string;
    userId: string;
    userRole?: string;
  }): Promise<WorkflowVersion | null> {
    try {
      const result = await executeSQL(`
        SELECT * FROM CORTEX_TESTING.PUBLIC.WORKFLOW_VERSIONS
        WHERE workflow_id = '${params.workflowId}'
          AND version_id = '${params.versionId}'
        LIMIT 1
      `);
      if (result.rowCount === 0) return null;
      return this.rowToVersion(result.rows[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduling (get / upsert / deactivate)
  // ---------------------------------------------------------------------------

  async getSchedule(params: {
    workflowId: string;
    userId: string;
    userRole?: string;
  }): Promise<WorkflowSchedule | null> {
    try {
      const result = await executeSQL(`
        SELECT * FROM CORTEX_TESTING.PUBLIC.WORKFLOW_SCHEDULES
        WHERE workflow_id = '${params.workflowId}'
          AND enabled = TRUE
        ORDER BY created_at DESC
        LIMIT 1
      `);
      if (result.rowCount === 0) return null;
      return this.rowToSchedule(result.rows[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async upsertSchedule(params: {
    workflowId: string;
    cronExpression: string;
    timezone: string;
    runAsUserId?: string;
    runAsRole?: string;
    useLatestVersion?: boolean;
    notifyOnSuccess?: boolean;
    notifyOnFailure?: boolean;
    notificationEmails?: string[];
    createdBy?: string;
    userRole?: string;
  }): Promise<WorkflowSchedule> {
    // Deactivate existing schedules
    try {
      await executeSQL(`
        UPDATE CORTEX_TESTING.PUBLIC.WORKFLOW_SCHEDULES
        SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP()
        WHERE workflow_id = '${params.workflowId}'
      `);
    } catch { /* non-blocking */ }

    return this.scheduleWorkflow(
      {
        workflowId: params.workflowId,
        cronExpression: params.cronExpression,
        timezone: params.timezone,
        runAsUserId: params.runAsUserId ?? params.createdBy ?? 'system',
        runAsRole: params.runAsRole ?? params.userRole ?? 'APP_SVC_ROLE',
        useLatestVersion: params.useLatestVersion ?? true,
        notifyOnSuccess: params.notifyOnSuccess ?? false,
        notifyOnFailure: params.notifyOnFailure ?? true,
        notificationEmails: params.notificationEmails ?? [],
      },
      params.createdBy ?? 'system',
    );
  }

  async deactivateSchedule(params: {
    workflowId: string;
    userId: string;
    userRole?: string;
  }): Promise<void> {
    try {
      await executeSQL(`
        UPDATE CORTEX_TESTING.PUBLIC.WORKFLOW_SCHEDULES
        SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP()
        WHERE workflow_id = '${params.workflowId}'
      `);
    } catch { /* non-blocking */ }
  }

  // ---------------------------------------------------------------------------
  // Shares (list / add / remove)
  // ---------------------------------------------------------------------------

  async listShares(params: {
    workflowId: string;
    userId: string;
    userRole?: string;
  }): Promise<WorkflowShare[]> {
    try {
      const result = await executeSQL(`
        SELECT * FROM CORTEX_TESTING.PUBLIC.WORKFLOW_SHARES
        WHERE workflow_id = '${params.workflowId}'
          AND revoked_at IS NULL
        ORDER BY granted_at DESC
      `);
      return result.rows.map((r) => this.rowToShare(r as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  async addShare(params: {
    workflowId: string;
    grantedBy: string;
    userRole?: string;
    sharedWithUserId?: string;
    sharedWithRole?: string;
    permission: SharePermission;
    expiresAt?: number;
  }): Promise<WorkflowShare> {
    return this.shareWorkflow(
      {
        workflowId: params.workflowId,
        sharedWithUserId: params.sharedWithUserId,
        sharedWithRole: params.sharedWithRole,
        permission: params.permission,
      },
      params.grantedBy,
    );
  }

  async removeShare(params: {
    workflowId: string;
    shareId: string;
    userId: string;
    userRole?: string;
  }): Promise<void> {
    return this.revokeShare(params.shareId, params.userId);
  }

  // ---------------------------------------------------------------------------
  // listWorkflows - add isTemplate filter support
  // ---------------------------------------------------------------------------

  async listTemplates(params: {
    userId: string;
    userRole?: string;
    limit?: number;
    offset?: number;
  }): Promise<WorkflowRecord[]> {
    return this.listWorkflows({
      userId: params.userId,
      userRole: params.userRole ?? 'APP_SVC_ROLE',
      filter: { status: 'active' },
      limit: params.limit,
      offset: params.offset,
    });
  }

  // ---------------------------------------------------------------------------
  // Row mappers
  // ---------------------------------------------------------------------------

  private rowToRecord(row: Record<string, unknown>): WorkflowRecord {
    let pipelineDefinition: PipelineDefinition;
    try {
      pipelineDefinition = JSON.parse(String(row['PIPELINE_DEFINITION'] ?? '{}')) as PipelineDefinition;
    } catch {
      pipelineDefinition = { id: '', name: '', description: '', steps: [], parallelizable: false, createdAt: 0, semanticViewDisplayName: '' };
    }

    return {
      id: String(row['WORKFLOW_ID'] ?? ''),
      name: String(row['NAME'] ?? ''),
      description: String(row['DESCRIPTION'] ?? ''),
      category: (String(row['CATEGORY'] ?? 'custom')) as WorkflowCategory,
      status: (String(row['STATUS'] ?? 'draft')) as WorkflowStatus,
      ownerId: String(row['OWNER_ID'] ?? ''),
      parameters: [],
      pipelineDefinition,
      tags: (() => {
        try { return JSON.parse(String(row['TAGS'] ?? '[]')) as string[]; } catch { return []; }
      })(),
      createdAt: row['CREATED_AT'] ? new Date(String(row['CREATED_AT'])).getTime() : 0,
      updatedAt: row['UPDATED_AT'] ? new Date(String(row['UPDATED_AT'])).getTime() : 0,
      runCount: Number(row['RUN_COUNT'] ?? 0),
    };
  }

  private rowToVersion(row: Record<string, unknown>): WorkflowVersion {
    let pipeline: PipelineDefinition;
    try {
      pipeline = JSON.parse(String(row['PIPELINE_DEFINITION_SNAPSHOT'] ?? '{}')) as PipelineDefinition;
    } catch {
      pipeline = { id: '', name: '', description: '', steps: [], parallelizable: false, createdAt: 0, semanticViewDisplayName: '' };
    }
    return {
      versionId: String(row['VERSION_ID'] ?? ''),
      workflowId: String(row['WORKFLOW_ID'] ?? ''),
      versionNumber: Number(row['VERSION_NUMBER'] ?? 1),
      label: String(row['LABEL'] ?? '1.0.0'),
      changelog: String(row['CHANGELOG'] ?? ''),
      pipelineDefinitionSnapshot: pipeline,
      createdBy: String(row['CREATED_BY'] ?? ''),
      isCurrent: Boolean(row['IS_CURRENT']),
      createdAt: row['CREATED_AT'] ? new Date(String(row['CREATED_AT'])).getTime() : 0,
    };
  }

  private rowToSchedule(row: Record<string, unknown>): WorkflowSchedule {
    return {
      id: String(row['SCHEDULE_ID'] ?? ''),
      workflowId: String(row['WORKFLOW_ID'] ?? ''),
      enabled: Boolean(row['ENABLED']),
      frequency: 'custom',
      cronExpression: String(row['CRON_EXPRESSION'] ?? ''),
      timezone: String(row['TIMEZONE'] ?? 'UTC'),
      parameterOverrides: {},
      notifyUserIds: [],
      runAsUserId: row['RUN_AS_USER_ID'] ? String(row['RUN_AS_USER_ID']) : undefined,
      runAsRole: row['RUN_AS_ROLE'] ? String(row['RUN_AS_ROLE']) : undefined,
      useLatestVersion: Boolean(row['USE_LATEST_VERSION']),
      createdBy: String(row['CREATED_BY'] ?? ''),
      createdAt: row['CREATED_AT'] ? new Date(String(row['CREATED_AT'])).getTime() : 0,
      updatedAt: row['UPDATED_AT'] ? new Date(String(row['UPDATED_AT'])).getTime() : 0,
    };
  }

  private rowToShare(row: Record<string, unknown>): WorkflowShare {
    return {
      id: String(row['SHARE_ID'] ?? ''),
      workflowId: String(row['WORKFLOW_ID'] ?? ''),
      granteeId: String(row['GRANTEE_ID'] ?? ''),
      granteeType: (String(row['GRANTEE_TYPE'] ?? 'user')) as 'user' | 'group',
      permission: (String(row['PERMISSION'] ?? 'view')) as SharePermission,
      grantedBy: String(row['GRANTED_BY'] ?? ''),
      grantedAt: row['GRANTED_AT'] ? new Date(String(row['GRANTED_AT'])).getTime() : 0,
    };
  }

  private rowToExecution(row: Record<string, unknown>): WorkflowExecution {
    return {
      id: String(row['EXECUTION_ID'] ?? ''),
      workflowId: String(row['WORKFLOW_ID'] ?? ''),
      workflowVersionId: String(row['WORKFLOW_VERSION_ID'] ?? ''),
      triggeredBy: (String(row['TRIGGERED_BY'] ?? 'user')) as WorkflowExecution['triggeredBy'],
      triggeredByUserId: String(row['TRIGGERED_BY_USER_ID'] ?? ''),
      sessionId: String(row['SESSION_ID'] ?? ''),
      status: (String(row['STATUS'] ?? 'queued')) as ExecutionStatus,
      resolvedParameters: {},
      stepExecutions: [],
      lineageId: String(row['LINEAGE_IDS'] ?? ''),
      startedAt: row['STARTED_AT'] ? new Date(String(row['STARTED_AT'])).getTime() : 0,
      completedAt: row['COMPLETED_AT'] ? new Date(String(row['COMPLETED_AT'])).getTime() : undefined,
      durationMs: row['COMPLETED_AT'] && row['STARTED_AT']
        ? new Date(String(row['COMPLETED_AT'])).getTime() - new Date(String(row['STARTED_AT'])).getTime()
        : undefined,
      error: row['ERROR_MESSAGE'] ? String(row['ERROR_MESSAGE']) : undefined,
    };
  }
}

export const workflowService = new WorkflowService();
