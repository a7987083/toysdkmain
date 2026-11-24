import type { ToyAdapter } from '../sdk-adapter/index.js';
import { validateRank, validateScore, type Board, type RankQuery } from '../sdk-contract/index.js';

interface Submission {
  score: number;
  result: Promise<{ score: number }>;
  completed: boolean;
}

export class GameLeaderboard {
  private readonly settlements = new Map<string, Submission>();

  constructor(private readonly adapter: ToyAdapter, private readonly board: Board = 1) {
    validateRank({ board });
  }

  list(options: Omit<RankQuery, 'board'> & { limit?: number } = {}) {
    return this.adapter.ranks({ ...options, board: this.board });
  }

  mine(period?: RankQuery['period']) {
    return this.adapter.myRank({ period, board: this.board });
  }

  /** The game supplies a unique ID per completed round. Duplicate IDs share the same submission. */
  async submitSettlement(id: string, score: number): Promise<{ score: number }> {
    if (!id.trim()) throw new Error('invalid_settlement_id');
    validateScore(score);
    const existing = this.settlements.get(id);
    if (existing) {
      if (existing.score !== score) throw new Error('settlement_score_mismatch');
      return existing.result;
    }
    const result = this.adapter.submit(score, this.board);
    const submission = { score, result, completed: false };
    this.settlements.set(id, submission);
    try {
      const response = await result;
      submission.completed = true;
      if (this.settlements.size > 256) {
        for (const [key, entry] of this.settlements) {
          if (entry.completed) this.settlements.delete(key);
          if (this.settlements.size <= 256) break;
        }
      }
      return response;
    } catch (error) {
      this.settlements.delete(id);
      throw error;
    }
  }
}
