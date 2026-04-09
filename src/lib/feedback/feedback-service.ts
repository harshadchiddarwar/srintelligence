/**
 * FeedbackService — stores user ratings and optional SQL corrections.
 * Not a singleton (stateless — instantiate per use or use the shared export).
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  FeedbackRecord,
  FeedbackRating,
  FeedbackCategory,
} from '../../types/user';
import { executeSQL } from '../snowflake/sql-api';

// ---------------------------------------------------------------------------
// Extra types specific to the service
// ---------------------------------------------------------------------------

export interface SubmitFeedbackParams {
  userId: string;
  sessionId?: string;
  executionId?: string;
  lineageId?: string;
  stepId?: string;
  agentName: string;
  intent?: string;
  rating: FeedbackRating;
  category: FeedbackCategory;
  comment?: string;
  /** If true, the user found the SQL to be incorrect */
  incorrectSql?: boolean;
  /** Corrected SQL provided by the user */
  sqlCorrection?: string;
}

export interface FeedbackStats {
  agentName: string;
  totalRatings: number;
  averageRating: number;
  ratingDistribution: Record<FeedbackRating, number>;
  categoryBreakdown: Record<FeedbackCategory, number>;
  sqlCorrectionCount: number;
}

export interface FeedbackDashboard {
  totalFeedback: number;
  averageRatingOverall: number;
  agentStats: FeedbackStats[];
  recentNegativeFeedback: FeedbackRecord[];
}

// ---------------------------------------------------------------------------
// FeedbackService
// ---------------------------------------------------------------------------

export class FeedbackService {
  async submitFeedback(params: SubmitFeedbackParams): Promise<FeedbackRecord> {
    const feedbackId = uuidv4();
    const now = Date.now();

    const comment = (params.comment ?? '').replace(/'/g, "\\'");
    const sessionId = params.sessionId ?? 'unknown';
    const executionId = params.executionId ?? 'unknown';
    const sql = `
      INSERT INTO CORTEX_TESTING.PUBLIC.RESULT_FEEDBACK (
        feedback_id, user_id, session_id, execution_id, lineage_id,
        agent_name, intent, rating, category, comment,
        incorrect_sql, created_at
      ) VALUES (
        '${feedbackId}',
        '${params.userId}',
        '${sessionId}',
        '${executionId}',
        ${params.lineageId ? `'${params.lineageId}'` : 'NULL'},
        '${params.agentName}',
        '${params.intent ?? 'UNKNOWN'}',
        ${params.rating},
        '${params.category}',
        '${comment}',
        ${params.incorrectSql ? 'TRUE' : 'FALSE'},
        CURRENT_TIMESTAMP()
      )
    `;

    await executeSQL(sql);

    // If negative + SQL correction provided, store the correction separately
    if (params.incorrectSql && params.sqlCorrection) {
      const correctionId = uuidv4();
      const corrected = params.sqlCorrection.replace(/'/g, "\\'");
      await executeSQL(`
        INSERT INTO CORTEX_TESTING.PUBLIC.FEEDBACK_SQL_CORRECTIONS (
          correction_id, feedback_id, agent_name,
          corrected_sql, status, created_at
        ) VALUES (
          '${correctionId}',
          '${feedbackId}',
          '${params.agentName}',
          '${corrected}',
          'pending',
          CURRENT_TIMESTAMP()
        )
      `);
    }

    const record: FeedbackRecord = {
      id: feedbackId,
      userId: params.userId,
      sessionId: sessionId,
      targetId: executionId,
      rating: params.rating,
      category: params.category,
      comment: params.comment,
      intent: (params.intent ?? 'UNKNOWN') as FeedbackRecord['intent'],
      createdAt: now,
    };

    return record;
  }

  // ---------------------------------------------------------------------------
  // Retrieval
  // ---------------------------------------------------------------------------

  /** Generic feedback retrieval used by the GET /api/feedback endpoint */
  async getFeedback(params: {
    userId: string;
    agentName?: string;
    startDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<FeedbackRecord[]> {
    const conditions: string[] = [`user_id = '${params.userId}'`];
    if (params.agentName) {
      conditions.push(`agent_name = '${params.agentName.replace(/'/g, "\\'")}'`);
    }
    if (params.startDate) {
      conditions.push(`created_at >= '${params.startDate}'`);
    }
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    try {
      const result = await executeSQL(`
        SELECT * FROM CORTEX_TESTING.PUBLIC.RESULT_FEEDBACK
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      return result.rows.map((r) => this.rowToRecord(r as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  async getFeedbackForExecution(executionId: string): Promise<FeedbackRecord[]> {
    try {
      const result = await executeSQL(
        `SELECT * FROM CORTEX_TESTING.PUBLIC.RESULT_FEEDBACK
         WHERE execution_id = '${executionId}'
         ORDER BY created_at DESC`,
      );
      return result.rows.map((r) => this.rowToRecord(r as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  async getFeedbackForAgent(
    agentName: string,
    params: { limit?: number; offset?: number; minRating?: number } = {},
  ): Promise<{ records: FeedbackRecord[]; stats: FeedbackStats }> {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const minRating = params.minRating ?? 1;

    try {
      const [recordResult, statsResult] = await Promise.all([
        executeSQL(`
          SELECT * FROM CORTEX_TESTING.PUBLIC.RESULT_FEEDBACK
          WHERE agent_name = '${agentName}' AND rating >= ${minRating}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `),
        executeSQL(`
          SELECT
            COUNT(*) AS total_ratings,
            AVG(rating) AS avg_rating,
            SUM(CASE WHEN incorrect_sql THEN 1 ELSE 0 END) AS sql_correction_count
          FROM CORTEX_TESTING.PUBLIC.RESULT_FEEDBACK
          WHERE agent_name = '${agentName}'
        `),
      ]);

      const records = recordResult.rows.map((r) =>
        this.rowToRecord(r as Record<string, unknown>),
      );

      const statsRow = (statsResult.rows[0] ?? {}) as Record<string, unknown>;
      const stats: FeedbackStats = {
        agentName,
        totalRatings: Number(statsRow['TOTAL_RATINGS'] ?? 0),
        averageRating: Number(statsRow['AVG_RATING'] ?? 0),
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        categoryBreakdown: {
          accuracy: 0,
          relevance: 0,
          speed: 0,
          narrative: 0,
          visualization: 0,
          other: 0,
        },
        sqlCorrectionCount: Number(statsRow['SQL_CORRECTION_COUNT'] ?? 0),
      };

      return { records, stats };
    } catch {
      return {
        records: [],
        stats: {
          agentName,
          totalRatings: 0,
          averageRating: 0,
          ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          categoryBreakdown: {
            accuracy: 0,
            relevance: 0,
            speed: 0,
            narrative: 0,
            visualization: 0,
            other: 0,
          },
          sqlCorrectionCount: 0,
        },
      };
    }
  }

  async getFeedbackStats(): Promise<FeedbackDashboard> {
    try {
      const [overallResult, agentResult, negativeResult] = await Promise.all([
        executeSQL(`
          SELECT COUNT(*) AS total, AVG(rating) AS avg_rating
          FROM CORTEX_TESTING.PUBLIC.RESULT_FEEDBACK
        `),
        executeSQL(`
          SELECT agent_name, COUNT(*) AS total, AVG(rating) AS avg_rating
          FROM CORTEX_TESTING.PUBLIC.RESULT_FEEDBACK
          GROUP BY agent_name
        `),
        executeSQL(`
          SELECT * FROM CORTEX_TESTING.PUBLIC.RESULT_FEEDBACK
          WHERE rating <= 2
          ORDER BY created_at DESC
          LIMIT 20
        `),
      ]);

      const overallRow = (overallResult.rows[0] ?? {}) as Record<string, unknown>;

      const agentStats: FeedbackStats[] = agentResult.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          agentName: String(row['AGENT_NAME'] ?? ''),
          totalRatings: Number(row['TOTAL'] ?? 0),
          averageRating: Number(row['AVG_RATING'] ?? 0),
          ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          categoryBreakdown: {
            accuracy: 0,
            relevance: 0,
            speed: 0,
            narrative: 0,
            visualization: 0,
            other: 0,
          },
          sqlCorrectionCount: 0,
        };
      });

      return {
        totalFeedback: Number(overallRow['TOTAL'] ?? 0),
        averageRatingOverall: Number(overallRow['AVG_RATING'] ?? 0),
        agentStats,
        recentNegativeFeedback: negativeResult.rows.map((r) =>
          this.rowToRecord(r as Record<string, unknown>),
        ),
      };
    } catch {
      return {
        totalFeedback: 0,
        averageRatingOverall: 0,
        agentStats: [],
        recentNegativeFeedback: [],
      };
    }
  }

  async promoteSQLCorrection(feedbackId: string): Promise<void> {
    await executeSQL(`
      UPDATE CORTEX_TESTING.PUBLIC.FEEDBACK_SQL_CORRECTIONS
      SET status = 'promoted', promoted_at = CURRENT_TIMESTAMP()
      WHERE feedback_id = '${feedbackId}'
    `);
  }

  // ---------------------------------------------------------------------------
  // Row mapper
  // ---------------------------------------------------------------------------

  private rowToRecord(row: Record<string, unknown>): FeedbackRecord {
    return {
      id: String(row['FEEDBACK_ID'] ?? ''),
      userId: String(row['USER_ID'] ?? ''),
      sessionId: String(row['SESSION_ID'] ?? ''),
      targetId: String(row['EXECUTION_ID'] ?? ''),
      rating: (Number(row['RATING'] ?? 3) as FeedbackRating),
      category: (String(row['CATEGORY'] ?? 'other') as FeedbackCategory),
      comment: row['COMMENT'] ? String(row['COMMENT']) : undefined,
      intent: row['INTENT'] ? (String(row['INTENT']) as FeedbackRecord['intent']) : undefined,
      createdAt: row['CREATED_AT'] ? new Date(String(row['CREATED_AT'])).getTime() : Date.now(),
    };
  }
}

export const feedbackService = new FeedbackService();
