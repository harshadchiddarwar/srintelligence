-- =============================================================================
-- SRIntelligence™ — Complete Database Setup
-- Target:  CORTEX_TESTING database
-- Schemas: PUBLIC (core tables) · ML (ML/Cortex-specific objects)
-- Run as SYSADMIN or a role with CREATE TABLE / CREATE TASK privileges.
-- =============================================================================

USE DATABASE CORTEX_TESTING;
USE WAREHOUSE COMPUTE_WH;          -- adjust to your warehouse name

-- Create schemas if they don't exist yet
CREATE SCHEMA IF NOT EXISTS PUBLIC;
CREATE SCHEMA IF NOT EXISTS ML;


-- =============================================================================
-- SECTION 1: USER_PREFERENCES
-- Stores per-user UI and analysis settings that are persisted between sessions.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.USER_PREFERENCES (
    USER_ID             VARCHAR(128)    NOT NULL,           -- Snowflake user or app-level user ID
    THEME               VARCHAR(16)     DEFAULT 'system',   -- 'light' | 'dark' | 'system'
    NUMBER_FORMAT       VARCHAR(8)      DEFAULT 'US',       -- 'US' (1,234.56) | 'EU' (1.234,56)
    DATE_FORMAT         VARCHAR(32)     DEFAULT 'YYYY-MM-DD',
    TIMEZONE            VARCHAR(64)     DEFAULT 'UTC',      -- IANA tz string

    -- Analysis defaults
    DEFAULT_SEMANTIC_VIEW_ID    VARCHAR(128),
    PREFERRED_FORECAST_MODEL    VARCHAR(32)  DEFAULT 'auto',  -- 'auto'|'prophet'|'sarima'|'holtwinters'|'xgboost'
    CACHE_PREFERENCE            VARCHAR(16)  DEFAULT 'normal', -- 'aggressive'|'normal'|'none'

    -- Budget
    MAX_DAILY_CREDITS   NUMBER(10, 4)   DEFAULT 100,

    -- Advanced toggles
    SHOW_SQL            BOOLEAN         DEFAULT FALSE,
    SHOW_LINEAGE        BOOLEAN         DEFAULT TRUE,

    -- Metadata
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),

    CONSTRAINT PK_USER_PREFERENCES PRIMARY KEY (USER_ID)
);

COMMENT ON TABLE PUBLIC.USER_PREFERENCES IS 'Per-user display, analysis, cache, and budget preferences.';


-- =============================================================================
-- SECTION 2: QUERY_CACHE
-- Short-lived cache of expensive query results to avoid re-running Cortex calls.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.QUERY_CACHE (
    CACHE_KEY           VARCHAR(512)    NOT NULL,   -- SHA-256 of (semantic_view + normalized_query)
    USER_ID             VARCHAR(128),               -- nullable — some caches are shared
    SESSION_ID          VARCHAR(128),
    SEMANTIC_VIEW_ID    VARCHAR(128),
    USER_QUESTION       TEXT,                       -- original question text (for debugging)
    RESULT_JSON         VARIANT,                    -- serialized AgentResult JSON
    INTENT              VARCHAR(64),
    AGENT_NAME          VARCHAR(128),
    CREDITS_CONSUMED    NUMBER(10, 6)   DEFAULT 0,
    HIT_COUNT           INTEGER         DEFAULT 0,  -- incremented on each cache hit
    EXPIRES_AT          TIMESTAMP_NTZ   NOT NULL,   -- TTL — row is invalid after this
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_ACCESSED_AT    TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),

    CONSTRAINT PK_QUERY_CACHE PRIMARY KEY (CACHE_KEY)
);

COMMENT ON TABLE PUBLIC.QUERY_CACHE IS 'TTL-based cache for costly Cortex Analyst / ML query results.';

-- Index on expiry for efficient cleanup
CREATE INDEX IF NOT EXISTS IDX_QUERY_CACHE_EXPIRES ON PUBLIC.QUERY_CACHE (EXPIRES_AT);
CREATE INDEX IF NOT EXISTS IDX_QUERY_CACHE_USER ON PUBLIC.QUERY_CACHE (USER_ID);

-- Scheduled task: purge expired cache rows every 15 minutes
CREATE OR REPLACE TASK PUBLIC.CLEANUP_QUERY_CACHE
    WAREHOUSE  = COMPUTE_WH
    SCHEDULE   = '15 MINUTE'
    COMMENT    = 'Removes expired rows from QUERY_CACHE to control storage costs.'
AS
DELETE FROM PUBLIC.QUERY_CACHE
WHERE EXPIRES_AT < CURRENT_TIMESTAMP();


-- =============================================================================
-- SECTION 3: CREDIT_USAGE_LOG
-- Append-only ledger of every credit-consuming operation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.CREDIT_USAGE_LOG (
    LOG_ID              VARCHAR(128)    DEFAULT UUID_STRING(),
    USER_ID             VARCHAR(128)    NOT NULL,
    SESSION_ID          VARCHAR(128),
    LINEAGE_ID          VARCHAR(128),           -- FK to DATA_LINEAGE (soft)
    OPERATION_TYPE      VARCHAR(64),            -- 'query'|'forecast'|'cluster'|'pipeline'
    AGENT_NAME          VARCHAR(128),
    SEMANTIC_VIEW_ID    VARCHAR(128),
    WAREHOUSE_CREDITS   NUMBER(12, 8)   DEFAULT 0,
    ANALYST_CREDITS     NUMBER(12, 8)   DEFAULT 0,
    LLM_TOKEN_COST      NUMBER(12, 8)   DEFAULT 0,
    TOTAL_CREDITS       NUMBER(12, 8)   DEFAULT 0,
    EXECUTION_TIME_MS   INTEGER,
    CACHE_STATUS        VARCHAR(16),            -- 'hit'|'miss'|'bypass'
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),

    CONSTRAINT PK_CREDIT_USAGE_LOG PRIMARY KEY (LOG_ID)
);

COMMENT ON TABLE PUBLIC.CREDIT_USAGE_LOG IS 'Immutable ledger of all credit-consuming operations for billing and audit.';

CREATE INDEX IF NOT EXISTS IDX_CREDIT_USAGE_USER    ON PUBLIC.CREDIT_USAGE_LOG (USER_ID, CREATED_AT);
CREATE INDEX IF NOT EXISTS IDX_CREDIT_USAGE_DATE    ON PUBLIC.CREDIT_USAGE_LOG (CREATED_AT);


-- =============================================================================
-- SECTION 4: DATA_LINEAGE
-- Tracks the full execution ancestry of every query / artifact.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.DATA_LINEAGE (
    LINEAGE_ID              VARCHAR(128)    NOT NULL,
    SESSION_ID              VARCHAR(128)    NOT NULL,
    USER_ID                 VARCHAR(128)    NOT NULL,
    TIMESTAMP               TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    SEMANTIC_VIEW_ID        VARCHAR(128),
    SEMANTIC_VIEW_NAME      VARCHAR(256),
    USER_QUESTION           TEXT,
    INTENT                  VARCHAR(64),
    AGENT_NAME              VARCHAR(128),

    -- Parent relationship (for pipeline sub-steps)
    PARENT_LINEAGE_ID       VARCHAR(128),   -- NULL for root node

    -- SQL traceability
    SOURCE_SQL              TEXT,           -- pre-execution / template SQL
    EXECUTED_SQL            TEXT,           -- actual SQL sent to Snowflake

    -- Access footprint
    TABLES_ACCESSED         ARRAY,          -- ['DB.SCHEMA.TABLE', ...]
    COLUMNS_ACCESSED        ARRAY,          -- ['TABLE.COLUMN', ...]
    FILTERS_APPLIED         ARRAY,          -- ['col = val', ...]

    -- Execution metrics
    ROW_COUNT               INTEGER,
    EXECUTION_TIME_MS       INTEGER,
    CACHE_STATUS            VARCHAR(16),
    CREDITS_CONSUMED        NUMBER(12, 8)   DEFAULT 0,

    CONSTRAINT PK_DATA_LINEAGE PRIMARY KEY (LINEAGE_ID)
);

COMMENT ON TABLE PUBLIC.DATA_LINEAGE IS 'Full execution lineage chain: who asked what, what SQL ran, what data was touched.';

CREATE INDEX IF NOT EXISTS IDX_LINEAGE_SESSION    ON PUBLIC.DATA_LINEAGE (SESSION_ID);
CREATE INDEX IF NOT EXISTS IDX_LINEAGE_USER       ON PUBLIC.DATA_LINEAGE (USER_ID, TIMESTAMP);
CREATE INDEX IF NOT EXISTS IDX_LINEAGE_PARENT     ON PUBLIC.DATA_LINEAGE (PARENT_LINEAGE_ID);
CREATE INDEX IF NOT EXISTS IDX_LINEAGE_TIMESTAMP  ON PUBLIC.DATA_LINEAGE (TIMESTAMP);


-- =============================================================================
-- SECTION 5: RESULT_FEEDBACK
-- User thumbs-up / thumbs-down ratings on individual agent responses.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.RESULT_FEEDBACK (
    FEEDBACK_ID     VARCHAR(128)    DEFAULT UUID_STRING(),
    USER_ID         VARCHAR(128)    NOT NULL,
    SESSION_ID      VARCHAR(128),
    LINEAGE_ID      VARCHAR(128),           -- FK to DATA_LINEAGE (soft)
    EXECUTION_ID    VARCHAR(128),
    STEP_ID         VARCHAR(128),
    AGENT_NAME      VARCHAR(128),
    RATING          VARCHAR(16)     NOT NULL,   -- 'positive' | 'negative'
    CATEGORY        VARCHAR(64),               -- 'correct'|'incorrect_data'|'incorrect_sql'|'slow'|'unclear'|'other'
    COMMENT         TEXT,
    CREATED_AT      TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),

    CONSTRAINT PK_RESULT_FEEDBACK PRIMARY KEY (FEEDBACK_ID)
);

COMMENT ON TABLE PUBLIC.RESULT_FEEDBACK IS 'User satisfaction ratings on agent results, linked to lineage records.';

CREATE INDEX IF NOT EXISTS IDX_FEEDBACK_AGENT     ON PUBLIC.RESULT_FEEDBACK (AGENT_NAME, CREATED_AT);
CREATE INDEX IF NOT EXISTS IDX_FEEDBACK_LINEAGE   ON PUBLIC.RESULT_FEEDBACK (LINEAGE_ID);
CREATE INDEX IF NOT EXISTS IDX_FEEDBACK_USER      ON PUBLIC.RESULT_FEEDBACK (USER_ID);


-- =============================================================================
-- SECTION 6: FEEDBACK_SQL_CORRECTIONS
-- Corrected SQL submitted by users when the generated SQL was wrong.
-- Can be promoted to a fine-tuning training set.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.FEEDBACK_SQL_CORRECTIONS (
    CORRECTION_ID   VARCHAR(128)    DEFAULT UUID_STRING(),
    FEEDBACK_ID     VARCHAR(128),           -- FK to RESULT_FEEDBACK (soft)
    LINEAGE_ID      VARCHAR(128),
    USER_ID         VARCHAR(128)    NOT NULL,
    AGENT_NAME      VARCHAR(128),
    ORIGINAL_SQL    TEXT,                   -- SQL generated by the agent
    CORRECTED_SQL   TEXT            NOT NULL, -- human-provided correct SQL
    USER_QUESTION   TEXT,                   -- context question
    STATUS          VARCHAR(32)     DEFAULT 'pending', -- 'pending'|'promoted'|'rejected'
    PROMOTED_BY     VARCHAR(128),           -- admin user who approved
    PROMOTED_AT     TIMESTAMP_NTZ,
    CREATED_AT      TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),

    CONSTRAINT PK_FEEDBACK_SQL_CORRECTIONS PRIMARY KEY (CORRECTION_ID)
);

COMMENT ON TABLE PUBLIC.FEEDBACK_SQL_CORRECTIONS IS 'Human-corrected SQL pairs used for RLHF / fine-tuning pipelines.';

CREATE INDEX IF NOT EXISTS IDX_SQL_CORRECTIONS_STATUS ON PUBLIC.FEEDBACK_SQL_CORRECTIONS (STATUS);


-- =============================================================================
-- SECTION 7: WORKFLOWS
-- Saved workflow definitions (pipelines + metadata).
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.WORKFLOWS (
    WORKFLOW_ID         VARCHAR(128)    DEFAULT UUID_STRING(),
    NAME                VARCHAR(256)    NOT NULL,
    DESCRIPTION         TEXT,
    CATEGORY            VARCHAR(64),    -- 'analytics'|'forecasting'|'clustering'|'reporting'|'custom'
    STATUS              VARCHAR(32)     DEFAULT 'draft',  -- 'draft'|'active'|'archived'|'deprecated'
    OWNER_ID            VARCHAR(128)    NOT NULL,
    ORGANIZATION_ID     VARCHAR(128),   -- optional team/org scope

    -- Parameterised pipeline definition stored as JSON
    PARAMETERS          VARIANT,        -- WorkflowParameter[]
    PIPELINE_DEFINITION VARIANT,        -- PipelineDefinition JSON
    TAGS                ARRAY,

    -- Run statistics
    RUN_COUNT           INTEGER         DEFAULT 0,
    LAST_RUN_AT         TIMESTAMP_NTZ,

    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),

    CONSTRAINT PK_WORKFLOWS PRIMARY KEY (WORKFLOW_ID)
);

COMMENT ON TABLE PUBLIC.WORKFLOWS IS 'Saved multi-step ML/analytics workflow definitions with parameters.';

CREATE INDEX IF NOT EXISTS IDX_WORKFLOWS_OWNER    ON PUBLIC.WORKFLOWS (OWNER_ID);
CREATE INDEX IF NOT EXISTS IDX_WORKFLOWS_STATUS   ON PUBLIC.WORKFLOWS (STATUS);
CREATE INDEX IF NOT EXISTS IDX_WORKFLOWS_ORG      ON PUBLIC.WORKFLOWS (ORGANIZATION_ID);


-- =============================================================================
-- SECTION 8: WORKFLOW_VERSIONS
-- Immutable snapshots of each published workflow version.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.WORKFLOW_VERSIONS (
    VERSION_ID                      VARCHAR(128)    DEFAULT UUID_STRING(),
    WORKFLOW_ID                     VARCHAR(128)    NOT NULL,   -- FK → WORKFLOWS
    VERSION_NUMBER                  INTEGER         NOT NULL,   -- monotonically increasing
    LABEL                           VARCHAR(64),                -- semver label e.g. '1.2.0'
    CHANGELOG                       TEXT,
    PIPELINE_DEFINITION_SNAPSHOT    VARIANT,        -- frozen copy of PipelineDefinition at publish time
    CREATED_BY                      VARCHAR(128)    NOT NULL,
    CREATED_AT                      TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    IS_CURRENT                      BOOLEAN         DEFAULT TRUE,  -- only one row per workflow should be TRUE

    CONSTRAINT PK_WORKFLOW_VERSIONS PRIMARY KEY (VERSION_ID),
    CONSTRAINT UQ_WORKFLOW_VERSION  UNIQUE (WORKFLOW_ID, VERSION_NUMBER)
);

COMMENT ON TABLE PUBLIC.WORKFLOW_VERSIONS IS 'Immutable version snapshots for workflow audit trail and rollback.';

CREATE INDEX IF NOT EXISTS IDX_WF_VERSIONS_WORKFLOW ON PUBLIC.WORKFLOW_VERSIONS (WORKFLOW_ID);


-- =============================================================================
-- SECTION 9: WORKFLOW_SHARES
-- Access control grants for sharing workflows between users or groups.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.WORKFLOW_SHARES (
    SHARE_ID        VARCHAR(128)    DEFAULT UUID_STRING(),
    WORKFLOW_ID     VARCHAR(128)    NOT NULL,   -- FK → WORKFLOWS
    GRANTEE_ID      VARCHAR(128)    NOT NULL,   -- user or group ID
    GRANTEE_TYPE    VARCHAR(16)     NOT NULL,   -- 'user' | 'group'
    PERMISSION      VARCHAR(32)     NOT NULL,   -- 'view'|'run'|'edit'|'admin'
    GRANTED_BY      VARCHAR(128)    NOT NULL,
    GRANTED_AT      TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    EXPIRES_AT      TIMESTAMP_NTZ,              -- NULL = never expires

    CONSTRAINT PK_WORKFLOW_SHARES PRIMARY KEY (SHARE_ID),
    CONSTRAINT UQ_WORKFLOW_GRANTEE UNIQUE (WORKFLOW_ID, GRANTEE_ID)
);

COMMENT ON TABLE PUBLIC.WORKFLOW_SHARES IS 'RBAC-style sharing grants on workflows (view / run / edit / admin).';

CREATE INDEX IF NOT EXISTS IDX_WF_SHARES_GRANTEE  ON PUBLIC.WORKFLOW_SHARES (GRANTEE_ID);
CREATE INDEX IF NOT EXISTS IDX_WF_SHARES_WORKFLOW  ON PUBLIC.WORKFLOW_SHARES (WORKFLOW_ID);


-- =============================================================================
-- SECTION 10: WORKFLOW_SCHEDULES
-- Cron-based or one-time schedules for automatic workflow runs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.WORKFLOW_SCHEDULES (
    SCHEDULE_ID             VARCHAR(128)    DEFAULT UUID_STRING(),
    WORKFLOW_ID             VARCHAR(128)    NOT NULL,   -- FK → WORKFLOWS
    ENABLED                 BOOLEAN         DEFAULT TRUE,
    FREQUENCY               VARCHAR(32),    -- 'once'|'hourly'|'daily'|'weekly'|'monthly'|'custom'
    CRON_EXPRESSION         VARCHAR(128),   -- e.g. '0 8 * * 1-5'  (custom schedules)
    TIMEZONE                VARCHAR(64)     DEFAULT 'UTC',  -- IANA tz

    -- Overrides applied at schedule run time
    PARAMETER_OVERRIDES     VARIANT,        -- Record<string, value>

    -- Notification targets
    NOTIFY_USER_IDS         ARRAY,          -- user IDs to email on completion/failure

    -- Next/last run tracking
    NEXT_RUN_AT             TIMESTAMP_NTZ,
    LAST_RUN_AT             TIMESTAMP_NTZ,

    CREATED_BY              VARCHAR(128)    NOT NULL,
    CREATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),

    CONSTRAINT PK_WORKFLOW_SCHEDULES PRIMARY KEY (SCHEDULE_ID)
);

COMMENT ON TABLE PUBLIC.WORKFLOW_SCHEDULES IS 'Scheduled triggers for automatic workflow execution with cron support and notifications.';

CREATE INDEX IF NOT EXISTS IDX_WF_SCHEDULES_WORKFLOW ON PUBLIC.WORKFLOW_SCHEDULES (WORKFLOW_ID);
CREATE INDEX IF NOT EXISTS IDX_WF_SCHEDULES_NEXT_RUN ON PUBLIC.WORKFLOW_SCHEDULES (NEXT_RUN_AT) WHERE ENABLED = TRUE;


-- =============================================================================
-- SECTION 11: WORKFLOW_EXECUTIONS
-- Per-run records with step-level detail, status, and performance metrics.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.WORKFLOW_EXECUTIONS (
    EXECUTION_ID            VARCHAR(128)    DEFAULT UUID_STRING(),
    WORKFLOW_ID             VARCHAR(128)    NOT NULL,   -- FK → WORKFLOWS
    WORKFLOW_VERSION_ID     VARCHAR(128),               -- FK → WORKFLOW_VERSIONS
    SCHEDULE_ID             VARCHAR(128),               -- FK → WORKFLOW_SCHEDULES (if scheduled)
    TRIGGERED_BY            VARCHAR(32)     NOT NULL,   -- 'user'|'schedule'|'api'
    TRIGGERED_BY_USER_ID    VARCHAR(128)    NOT NULL,
    SESSION_ID              VARCHAR(128),
    STATUS                  VARCHAR(32)     DEFAULT 'queued', -- 'queued'|'running'|'success'|'failed'|'cancelled'|'timed_out'
    RESOLVED_PARAMETERS     VARIANT,        -- final param values used
    STEP_EXECUTIONS         VARIANT,        -- StepExecutionRecord[] array
    LINEAGE_ID              VARCHAR(128),   -- FK to DATA_LINEAGE root node
    STARTED_AT              TIMESTAMP_NTZ,
    COMPLETED_AT            TIMESTAMP_NTZ,
    DURATION_MS             INTEGER,
    ERROR                   TEXT,

    CONSTRAINT PK_WORKFLOW_EXECUTIONS PRIMARY KEY (EXECUTION_ID)
);

COMMENT ON TABLE PUBLIC.WORKFLOW_EXECUTIONS IS 'One row per workflow run, including step-level execution records and final status.';

CREATE INDEX IF NOT EXISTS IDX_WF_EXEC_WORKFLOW    ON PUBLIC.WORKFLOW_EXECUTIONS (WORKFLOW_ID, STARTED_AT);
CREATE INDEX IF NOT EXISTS IDX_WF_EXEC_STATUS      ON PUBLIC.WORKFLOW_EXECUTIONS (STATUS);
CREATE INDEX IF NOT EXISTS IDX_WF_EXEC_USER        ON PUBLIC.WORKFLOW_EXECUTIONS (TRIGGERED_BY_USER_ID);
CREATE INDEX IF NOT EXISTS IDX_WF_EXEC_SCHEDULE    ON PUBLIC.WORKFLOW_EXECUTIONS (SCHEDULE_ID);


-- =============================================================================
-- SECTION 12: SCHEDULER_LOCKS
-- Distributed mutex to prevent duplicate scheduled runs across concurrent
-- Snowflake task invocations.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.SCHEDULER_LOCKS (
    LOCK_KEY        VARCHAR(256)    NOT NULL,   -- e.g. 'schedule:{SCHEDULE_ID}'
    ACQUIRED_BY     VARCHAR(256),               -- task name or instance identifier
    ACQUIRED_AT     TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    EXPIRES_AT      TIMESTAMP_NTZ   NOT NULL,   -- auto-expire to prevent dead locks

    CONSTRAINT PK_SCHEDULER_LOCKS PRIMARY KEY (LOCK_KEY)
);

COMMENT ON TABLE PUBLIC.SCHEDULER_LOCKS IS 'Distributed lock table used by the scheduler task to prevent duplicate runs.';

CREATE INDEX IF NOT EXISTS IDX_SCHEDULER_LOCKS_EXP ON PUBLIC.SCHEDULER_LOCKS (EXPIRES_AT);


-- =============================================================================
-- SECTION 13: APP_CONFIG
-- Key-value store for application-wide configuration flags.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.APP_CONFIG (
    CONFIG_KEY      VARCHAR(256)    NOT NULL,
    CONFIG_VALUE    TEXT,
    VALUE_TYPE      VARCHAR(32)     DEFAULT 'string',  -- 'string'|'number'|'boolean'|'json'
    DESCRIPTION     TEXT,
    IS_SECRET       BOOLEAN         DEFAULT FALSE,      -- mask in UI if true
    CREATED_AT      TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT      TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_BY      VARCHAR(128),

    CONSTRAINT PK_APP_CONFIG PRIMARY KEY (CONFIG_KEY)
);

COMMENT ON TABLE PUBLIC.APP_CONFIG IS 'Application-level feature flags and configuration key-value pairs.';

-- Seed essential config rows (use MERGE to be idempotent)
MERGE INTO PUBLIC.APP_CONFIG AS t
USING (
    SELECT * FROM VALUES
        ('feature.forecast.enabled',       'true',   'boolean', 'Enable ML Forecast agents',           FALSE),
        ('feature.cluster.enabled',        'true',   'boolean', 'Enable Clustering agent',             FALSE),
        ('feature.pipeline.enabled',       'true',   'boolean', 'Enable multi-step pipelines',         FALSE),
        ('cache.default_ttl_minutes',      '60',     'number',  'Default query cache TTL in minutes',  FALSE),
        ('cache.max_entries',              '10000',  'number',  'Max number of cache entries',         FALSE),
        ('budget.global_daily_limit',      '1000',   'number',  'Global credit limit per day',         FALSE),
        ('scheduler.max_concurrent_runs',  '5',      'number',  'Max concurrent scheduled runs',       FALSE),
        ('llm.default_model',              'claude-3-5-sonnet-20241022', 'string', 'Default LLM model', FALSE)
    AS src(CONFIG_KEY, CONFIG_VALUE, VALUE_TYPE, DESCRIPTION, IS_SECRET)
) AS s ON t.CONFIG_KEY = s.CONFIG_KEY
WHEN NOT MATCHED THEN
    INSERT (CONFIG_KEY, CONFIG_VALUE, VALUE_TYPE, DESCRIPTION, IS_SECRET)
    VALUES (s.CONFIG_KEY, s.CONFIG_VALUE, s.VALUE_TYPE, s.DESCRIPTION, s.IS_SECRET);


-- =============================================================================
-- SECTION 14: SEMANTIC_VIEW_REGISTRY
-- Registry of Snowflake views exposed as "semantic views" to agents.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.SEMANTIC_VIEW_REGISTRY (
    SEMANTIC_VIEW_ID        VARCHAR(128)    DEFAULT UUID_STRING(),
    DISPLAY_NAME            VARCHAR(256)    NOT NULL,
    DESCRIPTION             TEXT,
    FULLY_QUALIFIED_NAME    VARCHAR(512)    NOT NULL,   -- DB.SCHEMA.VIEW
    ALLOWED_ROLES           ARRAY,          -- Snowflake role names allowed to query
    IS_DEFAULT              BOOLEAN         DEFAULT FALSE,
    TAGS                    ARRAY,
    IS_ACTIVE               BOOLEAN         DEFAULT TRUE,
    CREATED_BY              VARCHAR(128),
    CREATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),

    CONSTRAINT PK_SEMANTIC_VIEW_REGISTRY PRIMARY KEY (SEMANTIC_VIEW_ID),
    CONSTRAINT UQ_SEMANTIC_VIEW_NAME     UNIQUE (FULLY_QUALIFIED_NAME)
);

COMMENT ON TABLE PUBLIC.SEMANTIC_VIEW_REGISTRY IS 'Catalogue of Snowflake views available as agent data sources, with RBAC metadata.';

CREATE INDEX IF NOT EXISTS IDX_SV_REGISTRY_ACTIVE ON PUBLIC.SEMANTIC_VIEW_REGISTRY (IS_ACTIVE);


-- =============================================================================
-- SECTION 15: USER_ROLE_MAPPING
-- Maps application users to Snowflake roles for RLS enforcement.
-- =============================================================================

CREATE TABLE IF NOT EXISTS PUBLIC.USER_ROLE_MAPPING (
    MAPPING_ID      VARCHAR(128)    DEFAULT UUID_STRING(),
    USER_ID         VARCHAR(128)    NOT NULL,
    SNOWFLAKE_ROLE  VARCHAR(256)    NOT NULL,   -- Snowflake role name
    IS_PRIMARY      BOOLEAN         DEFAULT FALSE, -- if multiple roles, one is primary
    GRANTED_BY      VARCHAR(128),
    GRANTED_AT      TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    EXPIRES_AT      TIMESTAMP_NTZ,              -- NULL = permanent

    CONSTRAINT PK_USER_ROLE_MAPPING PRIMARY KEY (MAPPING_ID),
    CONSTRAINT UQ_USER_ROLE         UNIQUE (USER_ID, SNOWFLAKE_ROLE)
);

COMMENT ON TABLE PUBLIC.USER_ROLE_MAPPING IS 'Maps app users to their permitted Snowflake roles for data access control.';

CREATE INDEX IF NOT EXISTS IDX_USER_ROLE_USER ON PUBLIC.USER_ROLE_MAPPING (USER_ID);


-- =============================================================================
-- SECTION 16: VIEWS
-- =============================================================================

-- ---- V_SEMANTIC_VIEWS -------------------------------------------------------
-- Active semantic view catalogue for the API layer.

CREATE OR REPLACE VIEW PUBLIC.V_SEMANTIC_VIEWS AS
SELECT
    SEMANTIC_VIEW_ID    AS id,
    DISPLAY_NAME        AS display_name,
    DESCRIPTION,
    FULLY_QUALIFIED_NAME AS fully_qualified_name,
    ALLOWED_ROLES       AS allowed_roles,
    IS_DEFAULT          AS is_default,
    TAGS
FROM PUBLIC.SEMANTIC_VIEW_REGISTRY
WHERE IS_ACTIVE = TRUE;

COMMENT ON VIEW PUBLIC.V_SEMANTIC_VIEWS IS 'Active semantic views exposed to the application and agents.';


-- ---- V_CREDIT_USAGE_DAILY ---------------------------------------------------
-- Daily credit summary per user for budget dashboards.

CREATE OR REPLACE VIEW PUBLIC.V_CREDIT_USAGE_DAILY AS
SELECT
    USER_ID,
    DATE_TRUNC('DAY', CREATED_AT)               AS usage_date,
    COUNT(*)                                    AS operation_count,
    SUM(WAREHOUSE_CREDITS)                      AS warehouse_credits,
    SUM(ANALYST_CREDITS)                        AS analyst_credits,
    SUM(LLM_TOKEN_COST)                         AS llm_token_cost,
    SUM(TOTAL_CREDITS)                          AS total_credits,
    ROUND(AVG(EXECUTION_TIME_MS), 0)            AS avg_execution_ms,
    COUNT_IF(CACHE_STATUS = 'hit')              AS cache_hits,
    COUNT_IF(CACHE_STATUS = 'miss')             AS cache_misses
FROM PUBLIC.CREDIT_USAGE_LOG
GROUP BY USER_ID, DATE_TRUNC('DAY', CREATED_AT);

COMMENT ON VIEW PUBLIC.V_CREDIT_USAGE_DAILY IS 'Daily credit consumption rolled up per user for billing and quota enforcement.';


-- ---- V_FEEDBACK_SUMMARY -----------------------------------------------------
-- Per-agent feedback stats for the admin dashboard.

CREATE OR REPLACE VIEW PUBLIC.V_FEEDBACK_SUMMARY AS
SELECT
    AGENT_NAME,
    COUNT(*)                                        AS total_feedback,
    COUNT_IF(RATING = 'positive')                   AS positive_count,
    COUNT_IF(RATING = 'negative')                   AS negative_count,
    ROUND(
        COUNT_IF(RATING = 'positive') * 100.0 / NULLIF(COUNT(*), 0),
        1
    )                                               AS satisfaction_pct,
    MAX(CREATED_AT)                                 AS last_feedback_at
FROM PUBLIC.RESULT_FEEDBACK
GROUP BY AGENT_NAME;

COMMENT ON VIEW PUBLIC.V_FEEDBACK_SUMMARY IS 'Aggregated satisfaction metrics per agent for the feedback admin dashboard.';


-- ---- V_CACHE_EFFECTIVENESS --------------------------------------------------
-- Rolling 24-hour cache hit ratio to guide TTL tuning.

CREATE OR REPLACE VIEW PUBLIC.V_CACHE_EFFECTIVENESS AS
SELECT
    DATE_TRUNC('HOUR', CREATED_AT)                  AS hour_bucket,
    COUNT(*)                                        AS total_operations,
    COUNT_IF(CACHE_STATUS = 'hit')                  AS cache_hits,
    COUNT_IF(CACHE_STATUS = 'miss')                 AS cache_misses,
    COUNT_IF(CACHE_STATUS = 'bypass')               AS cache_bypasses,
    ROUND(
        COUNT_IF(CACHE_STATUS = 'hit') * 100.0 / NULLIF(COUNT(*), 0),
        1
    )                                               AS hit_rate_pct,
    SUM(TOTAL_CREDITS)                              AS credits_consumed,
    SUM(CASE WHEN CACHE_STATUS = 'miss' THEN TOTAL_CREDITS ELSE 0 END) AS credits_on_misses
FROM PUBLIC.CREDIT_USAGE_LOG
WHERE CREATED_AT >= DATEADD('HOUR', -24, CURRENT_TIMESTAMP())
GROUP BY DATE_TRUNC('HOUR', CREATED_AT);

COMMENT ON VIEW PUBLIC.V_CACHE_EFFECTIVENESS IS 'Hourly cache hit/miss ratio to evaluate query cache effectiveness.';


-- ---- V_EXECUTION_HEALTH -----------------------------------------------------
-- Recent workflow execution success / failure rate.

CREATE OR REPLACE VIEW PUBLIC.V_EXECUTION_HEALTH AS
SELECT
    WORKFLOW_ID,
    DATE_TRUNC('DAY', STARTED_AT)                   AS run_date,
    COUNT(*)                                        AS total_runs,
    COUNT_IF(STATUS = 'success')                    AS successful_runs,
    COUNT_IF(STATUS = 'failed')                     AS failed_runs,
    COUNT_IF(STATUS = 'timed_out')                  AS timed_out_runs,
    COUNT_IF(STATUS = 'cancelled')                  AS cancelled_runs,
    ROUND(
        COUNT_IF(STATUS = 'success') * 100.0 / NULLIF(COUNT(*), 0),
        1
    )                                               AS success_rate_pct,
    ROUND(AVG(DURATION_MS), 0)                      AS avg_duration_ms,
    MAX(DURATION_MS)                                AS max_duration_ms
FROM PUBLIC.WORKFLOW_EXECUTIONS
WHERE STARTED_AT IS NOT NULL
GROUP BY WORKFLOW_ID, DATE_TRUNC('DAY', STARTED_AT);

COMMENT ON VIEW PUBLIC.V_EXECUTION_HEALTH IS 'Daily workflow run success/failure rates and duration metrics.';


-- ---- V_WORKFLOW_HEALTH -------------------------------------------------------
-- Current health snapshot per workflow (last-7-day window).

CREATE OR REPLACE VIEW PUBLIC.V_WORKFLOW_HEALTH AS
SELECT
    w.WORKFLOW_ID,
    w.NAME              AS workflow_name,
    w.STATUS            AS workflow_status,
    w.OWNER_ID,
    w.RUN_COUNT,
    w.LAST_RUN_AT,
    recent.total_runs_7d,
    recent.success_rate_pct_7d,
    recent.avg_duration_ms_7d,
    recent.last_status
FROM PUBLIC.WORKFLOWS w
LEFT JOIN (
    SELECT
        WORKFLOW_ID,
        COUNT(*)                                        AS total_runs_7d,
        ROUND(
            COUNT_IF(STATUS = 'success') * 100.0 / NULLIF(COUNT(*), 0),
            1
        )                                               AS success_rate_pct_7d,
        ROUND(AVG(DURATION_MS), 0)                      AS avg_duration_ms_7d,
        LAST_VALUE(STATUS) OVER (
            PARTITION BY WORKFLOW_ID ORDER BY STARTED_AT
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        )                                               AS last_status
    FROM PUBLIC.WORKFLOW_EXECUTIONS
    WHERE STARTED_AT >= DATEADD('DAY', -7, CURRENT_TIMESTAMP())
    GROUP BY WORKFLOW_ID
) recent ON w.WORKFLOW_ID = recent.WORKFLOW_ID;

COMMENT ON VIEW PUBLIC.V_WORKFLOW_HEALTH IS 'Per-workflow health snapshot for the last 7 days.';


-- ---- V_AGENT_HEALTH ---------------------------------------------------------
-- Agent-level health: throughput, latency, cache rate, satisfaction.

CREATE OR REPLACE VIEW PUBLIC.V_AGENT_HEALTH AS
SELECT
    c.AGENT_NAME,
    COUNT(*)                                                    AS total_operations,
    ROUND(AVG(c.EXECUTION_TIME_MS), 0)                          AS avg_latency_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY c.EXECUTION_TIME_MS), 0)
                                                                AS p95_latency_ms,
    ROUND(COUNT_IF(c.CACHE_STATUS = 'hit') * 100.0 / NULLIF(COUNT(*), 0), 1)
                                                                AS cache_hit_rate_pct,
    SUM(c.TOTAL_CREDITS)                                        AS total_credits,
    ROUND(AVG(c.TOTAL_CREDITS), 6)                              AS avg_credits_per_op,
    fb.total_feedback,
    fb.satisfaction_pct
FROM PUBLIC.CREDIT_USAGE_LOG c
LEFT JOIN PUBLIC.V_FEEDBACK_SUMMARY fb ON c.AGENT_NAME = fb.AGENT_NAME
WHERE c.CREATED_AT >= DATEADD('DAY', -7, CURRENT_TIMESTAMP())
GROUP BY c.AGENT_NAME, fb.total_feedback, fb.satisfaction_pct;

COMMENT ON VIEW PUBLIC.V_AGENT_HEALTH IS 'Per-agent performance, cache, cost, and satisfaction metrics for the last 7 days.';


-- =============================================================================
-- SECTION 17: SCHEDULED TASKS
-- =============================================================================

-- ---- WORKFLOW_SCHEDULER_TASK ------------------------------------------------
-- Fires every minute to check WORKFLOW_SCHEDULES for due runs.
-- Acquires a SCHEDULER_LOCK before inserting an execution row to prevent
-- duplicate concurrent runs.

CREATE OR REPLACE TASK PUBLIC.WORKFLOW_SCHEDULER_TASK
    WAREHOUSE   = COMPUTE_WH
    SCHEDULE    = '1 MINUTE'
    COMMENT     = 'Polls WORKFLOW_SCHEDULES every minute and enqueues overdue workflow runs.'
AS
BEGIN
    -- 1. Release any expired locks before trying to acquire new ones
    DELETE FROM PUBLIC.SCHEDULER_LOCKS
    WHERE EXPIRES_AT < CURRENT_TIMESTAMP();

    -- 2. Find all enabled schedules that are due (NEXT_RUN_AT <= now)
    --    and have no existing running execution (prevent overlap)
    LET c CURSOR FOR
        SELECT s.SCHEDULE_ID, s.WORKFLOW_ID, s.PARAMETER_OVERRIDES, s.NOTIFY_USER_IDS
        FROM PUBLIC.WORKFLOW_SCHEDULES s
        WHERE s.ENABLED = TRUE
          AND (s.NEXT_RUN_AT IS NULL OR s.NEXT_RUN_AT <= CURRENT_TIMESTAMP())
          AND NOT EXISTS (
              SELECT 1
              FROM PUBLIC.SCHEDULER_LOCKS l
              WHERE l.LOCK_KEY = 'schedule:' || s.SCHEDULE_ID
          )
          AND NOT EXISTS (
              SELECT 1
              FROM PUBLIC.WORKFLOW_EXECUTIONS e
              WHERE e.SCHEDULE_ID = s.SCHEDULE_ID
                AND e.STATUS = 'running'
          );

    -- 3. For each due schedule: acquire lock + insert execution row
    FOR row IN c DO
        -- Acquire lock (expires in 10 minutes as safety net)
        INSERT INTO PUBLIC.SCHEDULER_LOCKS (LOCK_KEY, ACQUIRED_BY, EXPIRES_AT)
        VALUES (
            'schedule:' || row.SCHEDULE_ID,
            'WORKFLOW_SCHEDULER_TASK',
            DATEADD('MINUTE', 10, CURRENT_TIMESTAMP())
        );

        -- Enqueue the execution
        INSERT INTO PUBLIC.WORKFLOW_EXECUTIONS (
            WORKFLOW_ID, SCHEDULE_ID, TRIGGERED_BY, TRIGGERED_BY_USER_ID,
            STATUS, RESOLVED_PARAMETERS, STARTED_AT
        )
        VALUES (
            row.WORKFLOW_ID,
            row.SCHEDULE_ID,
            'schedule',
            'SCHEDULER_TASK',
            'queued',
            row.PARAMETER_OVERRIDES,
            CURRENT_TIMESTAMP()
        );

        -- Update last_run_at and compute a naive next_run_at (+1 day as default;
        -- real cron parsing should be done in the application layer)
        UPDATE PUBLIC.WORKFLOW_SCHEDULES
        SET LAST_RUN_AT = CURRENT_TIMESTAMP(),
            UPDATED_AT  = CURRENT_TIMESTAMP()
        WHERE SCHEDULE_ID = row.SCHEDULE_ID;
    END FOR;
END;


-- ---- WORKFLOW_ALERT_CHECKER -------------------------------------------------
-- Checks for failed/timed-out runs and flags them for notification.
-- Runs every 15 minutes.

CREATE OR REPLACE TASK PUBLIC.WORKFLOW_ALERT_CHECKER
    WAREHOUSE   = COMPUTE_WH
    SCHEDULE    = '15 MINUTE'
    COMMENT     = 'Scans for failed or timed-out workflow executions and records alert events.'
AS
BEGIN
    -- Mark long-running queued/running executions as timed_out
    -- (threshold: 60 minutes without completion — adjust per SLA)
    UPDATE PUBLIC.WORKFLOW_EXECUTIONS
    SET STATUS       = 'timed_out',
        COMPLETED_AT = CURRENT_TIMESTAMP(),
        DURATION_MS  = DATEDIFF('millisecond', STARTED_AT, CURRENT_TIMESTAMP()),
        ERROR        = 'Execution exceeded 60-minute timeout threshold.'
    WHERE STATUS IN ('queued', 'running')
      AND STARTED_AT < DATEADD('MINUTE', -60, CURRENT_TIMESTAMP());

    -- Log alert to APP_CONFIG as a simple last-checked timestamp
    -- (A full notification system would call an external function or stored proc here)
    MERGE INTO PUBLIC.APP_CONFIG AS t
    USING (SELECT 'scheduler.last_alert_check' AS k, CURRENT_TIMESTAMP()::STRING AS v) AS s
        ON t.CONFIG_KEY = s.k
    WHEN MATCHED     THEN UPDATE SET CONFIG_VALUE = s.v, UPDATED_AT = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT (CONFIG_KEY, CONFIG_VALUE, VALUE_TYPE, DESCRIPTION)
                          VALUES (s.k, s.v, 'string', 'Timestamp of last alert check run');
END;


-- ---- CLEANUP_SCHEDULER_LOCKS ------------------------------------------------
-- Removes expired scheduler lock rows every hour to keep the table lean.

CREATE OR REPLACE TASK PUBLIC.CLEANUP_SCHEDULER_LOCKS
    WAREHOUSE   = COMPUTE_WH
    SCHEDULE    = '60 MINUTE'
    COMMENT     = 'Purges expired rows from SCHEDULER_LOCKS every hour.'
AS
DELETE FROM PUBLIC.SCHEDULER_LOCKS
WHERE EXPIRES_AT < CURRENT_TIMESTAMP();


-- =============================================================================
-- Resume tasks
-- Tasks are created in SUSPENDED state; resume them when ready for production.
-- =============================================================================

-- ALTER TASK PUBLIC.WORKFLOW_SCHEDULER_TASK RESUME;
-- ALTER TASK PUBLIC.WORKFLOW_ALERT_CHECKER   RESUME;
-- ALTER TASK PUBLIC.CLEANUP_SCHEDULER_LOCKS  RESUME;
-- ALTER TASK PUBLIC.CLEANUP_QUERY_CACHE      RESUME;


-- =============================================================================
-- END OF SETUP SCRIPT
-- =============================================================================
