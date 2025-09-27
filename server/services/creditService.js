import { pool } from '../config/database.js';

class CreditService {
  async checkAndDeductCredits(userId, operation, amount, userToken = null) {
    try {
      // Lock row for update to prevent race conditions
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const balanceResult = await client.query(
          'SELECT credits_remaining FROM users WHERE id = $1 FOR UPDATE',
          [userId]
        );
        if (balanceResult.rows.length === 0) {
          throw new Error('User not found');
        }
        const currentBalance = parseFloat(balanceResult.rows[0].credits_remaining || 0);
        if (currentBalance < amount) {
          await client.query('ROLLBACK');
          return {
            success: false,
            error: 'insufficient_credits',
            creditsAvailable: currentBalance,
            creditsRequired: amount
          };
        }
        const newBalance = currentBalance - amount;
        await client.query(
          'UPDATE users SET credits_remaining = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newBalance, userId]
        );
        await client.query(
          `INSERT INTO credit_transactions (user_id, type, credits_amount, description, created_at, service_name)
           VALUES ($1, 'usage', $2, $3, CURRENT_TIMESTAMP, 'linkedin-genie')`,
          [userId, -amount, `${operation} - ${amount} credits deducted`]
        );
        await client.query('COMMIT');
        return {
          success: true,
          creditsDeducted: amount,
          creditsAvailable: newBalance
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Error in checkAndDeductCredits:', error.message);
      return { success: false, error: error.message };
    }
  }
  constructor() {
    this.platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
  }

  async getBalance(userId) {
    const result = await pool.query('SELECT credits_remaining FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return 0;
    return parseFloat(result.rows[0].credits_remaining || 0);
  }

  async getUsageHistory(userId, { page = 1, limit = 20, type } = {}) {
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM credit_transactions WHERE user_id = $1';
    const params = [userId];
    if (type) {
      query += ' AND type = $2';
      params.push(type);
    }
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    const result = await pool.query(query, params);
    return result.rows;
  }

  async refund(userId, amount, reason, transaction_type) {
    await pool.query(
      'UPDATE users SET credits_remaining = credits_remaining + $1 WHERE id = $2',
      [amount, userId]
    );
    await pool.query(
      `INSERT INTO credit_transactions (user_id, type, credits_amount, description, created_at, service_name) 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'linkedin-genie')`,
      [userId, transaction_type || 'refund', amount, reason]
    );
  }
}

const creditService = new CreditService();
export default creditService;
