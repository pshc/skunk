import Redis from 'ioredis';

require('dotenv').config();

export const redis = new Redis({ password: process.env.REDIS_PASSWORD });
