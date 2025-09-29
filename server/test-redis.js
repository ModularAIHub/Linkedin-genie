import { createClient } from 'redis';
import dotenv from 'dotenv';
dotenv.config();
const client = createClient({ url: process.env.REDIS_URL });
client.on('connect', () => console.log('Connected to Redis!'));
client.on('error', err => console.error('Redis error:', err));
client.connect();
