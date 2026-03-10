"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const fs_1 = require("fs");
const path_1 = require("path");
const models_1 = require("./models");
const migrationsDir = (0, path_1.join)(__dirname, '../../migrations');
async function runMigrations() {
    console.log('Running migrations...');
    // Get all .sql files sorted
    const files = (0, fs_1.readdirSync)(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();
    for (const file of files) {
        const filePath = (0, path_1.join)(migrationsDir, file);
        const sql = (0, fs_1.readFileSync)(filePath, 'utf-8');
        try {
            await models_1.db.query(sql);
            console.log(`✓ Applied migration: ${file}`);
        }
        catch (error) {
            console.error(`✗ Failed migration: ${file}`, error);
            throw error;
        }
    }
    console.log('All migrations completed.');
}
//# sourceMappingURL=migrate.js.map