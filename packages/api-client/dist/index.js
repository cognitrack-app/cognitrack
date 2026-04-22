"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentUserId = exports.getCurrentUser = exports.onAuthChange = exports.signOut = exports.signUp = exports.signIn = exports.auth = exports.db = void 0;
var firebase_1 = require("./firebase");
Object.defineProperty(exports, "db", { enumerable: true, get: function () { return firebase_1.db; } });
Object.defineProperty(exports, "auth", { enumerable: true, get: function () { return firebase_1.auth; } });
var auth_1 = require("./auth");
Object.defineProperty(exports, "signIn", { enumerable: true, get: function () { return auth_1.signIn; } });
Object.defineProperty(exports, "signUp", { enumerable: true, get: function () { return auth_1.signUp; } });
Object.defineProperty(exports, "signOut", { enumerable: true, get: function () { return auth_1.signOut; } });
Object.defineProperty(exports, "onAuthChange", { enumerable: true, get: function () { return auth_1.onAuthChange; } });
Object.defineProperty(exports, "getCurrentUser", { enumerable: true, get: function () { return auth_1.getCurrentUser; } });
Object.defineProperty(exports, "getCurrentUserId", { enumerable: true, get: function () { return auth_1.getCurrentUserId; } });
__exportStar(require("./device"), exports);
__exportStar(require("./sessions"), exports);
