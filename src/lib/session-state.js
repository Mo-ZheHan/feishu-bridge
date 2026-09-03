'use strict';

const fs = require('fs');
const path = require('path');

// 交互条目总量上限：超过就按 created_at 删最旧的（纯计数、不看年龄）。所有卡类型 + live_msg + __stop_sent
// 共用这个预算。放宽到 1000 是为了配合 72h 的时间窗口——否则一天约 150 条的量下，计数上限会先于时间过期
// 把还想回复的旧卡顶掉，成了"看不见的真过期"。
const MAX_ENTRIES = 1000;

class SessionState {
    constructor(statePath) {
        this.statePath = statePath || path.join(__dirname, '..', 'session-state.json');
        this.tmpPath = this.statePath + '.tmp';
        this.data = {};
    }

    /**
     * Reads JSON from disk into this.data.
     * Creates empty {} if file doesn't exist or is corrupted.
     * Returns this for chaining.
     */
    load() {
        try {
            const raw = fs.readFileSync(this.statePath, 'utf8');
            this.data = JSON.parse(raw);
        } catch (err) {
            // File doesn't exist, permission error, or JSON parse error
            this.data = {};
        }
        return this;
    }

    /**
     * Atomic write: write to .tmp file, then rename.
     * Prevents corruption from concurrent access.
     */
    save() {
        try {
            const json = JSON.stringify(this.data, null, 2);
            fs.writeFileSync(this.tmpPath, json, 'utf8');
            fs.renameSync(this.tmpPath, this.statePath);
        } catch (err) {
            // Log but don't crash — a write failure should not take down the process
            console.error('[session-state] Failed to save state:', err.message);
        }
    }

    /**
     * Adds a notification entry keyed by message ID or state key.
     * entry: { session_id, notification_type, pts_device, created_at, responses }
     *
     * Optimizations:
     * - Cleans stale Stop/StopFailure entries from the same terminal
     * - Caps total entries at MAX_ENTRIES (default 1000)
     */
    addNotification(messageId, entry) {
        this.load();

        this.data[messageId] = entry;

        // 上限保护：超过 MAX_ENTRIES 条时删除最旧的
        const keys = Object.keys(this.data).filter((key) => key !== '__meta__');
        if (keys.length > MAX_ENTRIES) {
            const sorted = keys.sort((a, b) => (this.data[a].created_at || 0) - (this.data[b].created_at || 0));
            const removeCount = keys.length - MAX_ENTRIES;
            for (let i = 0; i < removeCount; i++) {
                delete this.data[sorted[i]];
            }
        }

        this.save();
    }

    /**
     * Returns the notification entry for a given message ID, or null.
     * Always loads fresh data from disk first.
     */
    getNotification(messageId) {
        this.load();
        return this.data[messageId] || null;
    }

    /**
     * Removes a notification entry and persists the change.
     */
    removeNotification(messageId) {
        this.load();
        delete this.data[messageId];
        this.save();
    }

    /**
     * 记录最近一次有效交互的终端设备（用于多终端路由）
     */
    setLastInteractedDevice(ptsDevice) {
        if (!ptsDevice) return;
        this.load();
        // 合并而非整体覆盖：__meta__ 还存着「全局允许」的终端表，整体覆盖会把它抹掉
        this.data['__meta__'] = { ...(this.data['__meta__'] || {}), lastInteractedDevice: ptsDevice, updated_at: Date.now() };
        this.save();
    }

    /**
     * 获取指定终端的最新通知。
     */
    getLatestNotificationForDevice(ptsDevice) {
        this.load();
        let latestKey = null;
        let latestTime = -1;
        for (const [key, entry] of Object.entries(this.data)) {
            if (key === '__meta__') continue;
            if (entry.pts_device !== ptsDevice) continue;
            const createdAt = entry.created_at || 0;
            if (createdAt > latestTime) {
                latestTime = createdAt;
                latestKey = key;
            }
        }
        if (latestKey === null) return null;
        return { messageId: latestKey, ...this.data[latestKey] };
    }

    /**
     * Returns the most recent notification by created_at.
     * 优先返回最近一次有效交互的终端的通知，多终端场景下避免路由到错误终端。
     * Returns null if no notifications exist.
     */
    getLatestNotification() {
        this.load();

        // 优先按最近交互的终端路由
        const lastDevice = this.data['__meta__']?.lastInteractedDevice;
        if (lastDevice) {
            const deviceLatest = this.getLatestNotificationForDevice(lastDevice);
            if (deviceLatest) return deviceLatest;
        }

        // 默认取全局最新（排除 __meta__）
        let latestKey = null;
        let latestTime = -1;
        for (const [key, entry] of Object.entries(this.data)) {
            if (key === '__meta__') continue;
            const createdAt = entry.created_at || 0;
            if (createdAt > latestTime) {
                latestTime = createdAt;
                latestKey = key;
            }
        }
        if (latestKey === null) return null;
        return { messageId: latestKey, ...this.data[latestKey] };
    }

    /**
     * Removes entries older than maxAgeMs.
     * Default 72 hours, configurable via NOTIFICATION_EXPIRE_HOURS env var.
     */
    cleanExpired(maxAgeMs) {
        if (!maxAgeMs) {
            const hours = parseFloat(process.env.NOTIFICATION_EXPIRE_HOURS) || 72;
            maxAgeMs = hours * 3600000;
        }
        this.load();

        const now = Date.now();
        let changed = false;

        for (const [key, entry] of Object.entries(this.data)) {
            if (key === '__meta__') continue;
            const createdAt = entry.created_at || 0;
            if (now - createdAt > maxAgeMs) {
                delete this.data[key];
                changed = true;
            }
        }

        if (changed) {
            this.save();
        }
    }
}

module.exports = {
    SessionState,
    sessionState: new SessionState(),
};
