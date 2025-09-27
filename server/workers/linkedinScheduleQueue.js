import { Queue } from 'bullmq';
import { createClient } from 'redis';
import dotenv from 'dotenv';
dotenv.config();

const connection = createClient({
  url: process.env.REDIS_URL,
});

export const linkedinScheduleQueue = new Queue('linkedin-schedule', {
  connection,
});
