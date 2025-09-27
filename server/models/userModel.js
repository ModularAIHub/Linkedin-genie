// LinkedIn Genie User Model
// Add user DB methods as needed for LinkedIn Genie
import { pool } from '../config/database.js';

export async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0];
}
// Add more user methods as needed
