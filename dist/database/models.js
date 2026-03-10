"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.Database = void 0;
const pg_1 = require("pg");
const ioredis_1 = require("ioredis");
const config_1 = __importDefault(require("../config"));
class Database {
    pool;
    redis;
    constructor() {
        this.pool = new pg_1.Pool({
            connectionString: config_1.default.database.url,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
        this.redis = new ioredis_1.Redis(config_1.default.database.redisUrl);
    }
    async query(text, params) {
        const start = Date.now();
        try {
            const res = await this.pool.query(text, params);
            const duration = Date.now() - start;
            console.log('Executed query', { text, duration, rows: res.rowCount });
            return res;
        }
        catch (error) {
            console.error('Database query error', { text, error });
            throw error;
        }
    }
    async transaction(callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async getRedis() {
        return this.redis;
    }
    async close() {
        await this.pool.end();
        await this.redis.quit();
    }
}
exports.Database = Database;
// Singleton instance
exports.db = new Database();
exports.default = exports.db;
//# sourceMappingURL=models.js.map