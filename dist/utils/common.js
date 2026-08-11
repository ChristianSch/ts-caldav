"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSlashEnd = normalizeSlashEnd;
exports.first = first;
function normalizeSlashEnd(u) {
    return u.endsWith("/") ? u.slice(0, -1) : u;
}
function first(val) {
    return Array.isArray(val) ? val[0] : val;
}
//# sourceMappingURL=common.js.map