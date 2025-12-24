# 海尔 Claude Code Router 技术设计文档

## 文档信息
- **版本**: v1.0
- **创建日期**: 2025-12-03
- **设计原则**: 非侵入式改造,保持原有功能完整性

---

## 目录

1. [设计原则](#1-设计原则)
2. [整体架构](#2-整体架构)
3. [适配器设计](#3-适配器设计)
4. [详细实现](#4-详细实现)
5. [数据库设计](#5-数据库设计)
6. [部署方案](#6-部署方案)

---

## 1. 设计原则

### 1.1 核心原则

**非侵入式适配层架构**

```
┌────────────────────────────────────────────────────────┐
│              原有 CCR 功能 (保持 100% 不变)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │API Key   │  │多模型路由│  │Transformer          │
│  │认证      │  │          │  │系统      │            │
│  └──────────┘  └──────────┘  └──────────┘            │
└────────────────────┬───────────────────────────────────┘
                     │ 通过 Fastify Hooks 插入
                     ↓
┌────────────────────────────────────────────────────────┐
│            海尔企业适配层 (可选启用)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │OAuth认证 │  │配额管理  │  │行为上报  │            │
│  └──────────┘  └──────────┘  └──────────┘            │
└────────────────────────────────────────────────────────┘
```

**设计约束:**
- ✅ 零破坏: 不修改原有核心代码
- ✅ 可插拔: 企业功能可完全禁用
- ✅ 配置驱动: 通过配置控制启用
- ✅ 独立部署: 后台服务独立
- ✅ 向下兼容: 支持原有配置格式

### 1.2 技术选型

**本地服务 (保持不变):**
- Node.js + TypeScript
- Fastify 框架
- @musistudio/llms (LLM 抽象层)

**新增依赖:**
```json
{
  "axios": "^1.6.0",           // HTTP 客户端
  "better-sqlite3": "^9.0.0",  // SQLite (事件队列)
  "jsonwebtoken": "^9.0.0"     // JWT Token 处理
}
```

**后台服务 (新增):**
- 框架: Spring Boot / Node.js Fastify
- 数据库: PostgreSQL
- 缓存: Redis
- 消息队列: Kafka

---

## 2. 整体架构

### 2.1 系统架构图

```
┌───────────────────────────────────────────────────────────┐
│                      Claude Code CLI                      │
└────────────────────────┬──────────────────────────────────┘
                         │ HTTP
                         ↓
┌───────────────────────────────────────────────────────────┐
│                  CCR Local Service                        │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Fastify Server                                    │  │
│  │  端点: /v1/messages, /api/config, /ui/*           │  │
│  └────────────────────────────────────────────────────┘  │
│           ↓                                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Middleware Pipeline                               │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ 1. 原有 API Key Auth (保持不变)             │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  │           ↓                                         │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ 2. AuthAdapter (企业模式,可选)              │  │  │
│  │  │    - OAuth Token 验证                        │  │  │
│  │  │    - 用户上下文注入                          │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  │           ↓                                         │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ 3. QuotaAdapter (企业模式,可选)             │  │  │
│  │  │    - 配额检查                                │  │  │
│  │  │    - 预估消耗                                │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│           ↓                                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │  原有路由逻辑 (保持不变)                          │  │
│  │  - 模型选择                                        │  │
│  │  - Transformer                                     │  │
│  └────────────────────────────────────────────────────┘  │
│           ↓                                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │  onSend Hook                                       │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ 1. 原有 Usage 追踪 (保持不变)               │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  │           ↓                                         │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ 2. QuotaAdapter.deduct (异步)                │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  │           ↓                                         │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ 3. AnalyticsAdapter.report (异步)           │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└────────────────────────┬──────────────────────────────────┘
                         │ HTTPS (仅企业模式)
                         ↓
┌───────────────────────────────────────────────────────────┐
│                  海尔企业后台服务                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐│
│  │认证服务  │  │模型服务  │  │配额服务  │  │分析服务  ││
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘│
└───────────────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
src/
├── adapters/                    # 新增:企业适配器层
│   ├── index.ts                # AdapterManager
│   ├── types.ts                # 适配器接口定义
│   ├── auth.adapter.ts         # OAuth 认证适配器
│   ├── quota.adapter.ts        # 配额管理适配器
│   ├── analytics.adapter.ts    # 行为上报适配器
│   └── model.adapter.ts        # 模型同步适配器
│
├── enterprise/                  # 新增:企业功能实现
│   ├── oauth/
│   │   ├── client.ts           # OAuth 客户端
│   │   ├── token-manager.ts    # Token 管理
│   │   └── types.ts            # 类型定义
│   ├── quota/
│   │   ├── checker.ts          # 配额检查器
│   │   ├── calculator.ts       # 配额计算器
│   │   └── cache.ts            # 配额缓存
│   ├── analytics/
│   │   ├── collector.ts        # 事件采集器
│   │   ├── queue.ts            # 本地队列 (SQLite)
│   │   ├── reporter.ts         # 批量上报器
│   │   └── events.ts           # 事件定义
│   └── models/
│       ├── fetcher.ts          # 模型清单拉取
│       ├── merger.ts           # 配置合并器
│       └── types.ts            # 类型定义
│
├── database/                    # 新增:本地数据库
│   ├── schema.sql              # SQLite Schema
│   └── client.ts               # 数据库客户端
│
├── cli.ts                       # 改造:增加企业命令
├── index.ts                     # 改造:注册适配器
├── server.ts                    # 保持不变
├── types.ts                     # 扩展:企业配置类型
├── middleware/
│   └── auth.ts                  # 保持不变
├── utils/
│   ├── router.ts                # 保持不变
│   └── ...                      # 其他工具保持不变
└── agents/                      # 保持不变
```

---

## 3. 适配器设计

### 3.1 适配器接口

**src/adapters/types.ts:**

```typescript
import { FastifyInstance } from 'fastify';

/**
 * 适配器基础接口
 */
export interface IAdapter {
  /**
   * 注册适配器到 Fastify 服务器
   * 在这里添加 hooks, 路由等
   */
  register(server: FastifyInstance): Promise<void>;

  /**
   * 清理资源 (可选)
   * 在服务关闭时调用
   */
  cleanup?(): Promise<void>;
}

/**
 * 适配器配置
 */
export interface AdapterConfig {
  enabled: boolean;
  [key: string]: any;
}
```

### 3.2 AdapterManager

**src/adapters/index.ts:**

```typescript
import { FastifyInstance } from 'fastify';
import { IAdapter } from './types';
import { AuthAdapter } from './auth.adapter';
import { QuotaAdapter } from './quota.adapter';
import { AnalyticsAdapter } from './analytics.adapter';
import { ModelAdapter } from './model.adapter';

export class AdapterManager {
  private adapters: Map<string, IAdapter> = new Map();

  /**
   * 注册所有适配器
   */
  async register(server: FastifyInstance, config: any) {
    // 检查企业模式是否启用
    if (!config.HAIER_ENTERPRISE_MODE) {
      console.log('[AdapterManager] Enterprise mode disabled');
      return;
    }

    console.log('[AdapterManager] Enterprise mode enabled, registering adapters...');

    // 按顺序注册适配器
    await this.registerAdapter('auth', AuthAdapter, config.HAIER_OAUTH, server);
    await this.registerAdapter('model', ModelAdapter, config.HAIER_MODEL_SYNC, server);
    await this.registerAdapter('quota', QuotaAdapter, config.HAIER_QUOTA, server);
    await this.registerAdapter('analytics', AnalyticsAdapter, config.HAIER_ANALYTICS, server);
  }

  /**
   * 注册单个适配器
   */
  private async registerAdapter(
    name: string,
    AdapterClass: any,
    config: any,
    server: FastifyInstance
  ) {
    if (!config?.enabled) {
      console.log(`[AdapterManager] ${name} adapter disabled`);
      return;
    }

    const adapter = new AdapterClass(config);
    await adapter.register(server);
    this.adapters.set(name, adapter);
    console.log(`[AdapterManager] ✓ ${name} adapter registered`);
  }

  /**
   * 获取适配器实例
   */
  getAdapter(name: string): IAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * 清理所有适配器
   */
  async cleanup() {
    for (const [name, adapter] of this.adapters.entries()) {
      if (adapter.cleanup) {
        console.log(`[AdapterManager] Cleaning up ${name} adapter`);
        await adapter.cleanup();
      }
    }
  }
}
```

### 3.3 配置扩展

**src/types.ts:**

```typescript
// 扩展原有 Config 类型
export interface HaierEnterpriseConfig {
  // 企业模式开关
  HAIER_ENTERPRISE_MODE?: boolean;

  // OAuth 配置
  HAIER_OAUTH?: {
    enabled: boolean;
    client_id: string;
    client_secret: string;
    auth_url: string;
    token_url: string;
    user_info_url: string;
    callback_url: string;
  };

  // 配额管理配置
  HAIER_QUOTA?: {
    enabled: boolean;
    backend_url: string;
    cache_ttl?: number;  // 默认 300000 (5分钟)
  };

  // 数据分析配置
  HAIER_ANALYTICS?: {
    enabled: boolean;
    backend_url: string;
    batch_size?: number;      // 默认 10
    batch_interval?: number;  // 默认 30000 (30秒)
  };

  // 模型同步配置
  HAIER_MODEL_SYNC?: {
    enabled: boolean;
    backend_url: string;
    merge_strategy?: 'auto' | 'haier-first' | 'user-first' | 'haier-only' | 'user-only';
    sync_interval?: number;  // 默认 3600000 (1小时)
  };
}

// 合并到原有 Config
export type Config = OriginalConfig & HaierEnterpriseConfig;
```

---

## 4. 详细实现

### 4.1 OAuth 认证适配器

**src/adapters/auth.adapter.ts:**

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { IAdapter } from './types';
import { OAuthClient } from '../enterprise/oauth/client';
import { TokenManager } from '../enterprise/oauth/token-manager';

export class AuthAdapter implements IAdapter {
  private oauthClient: OAuthClient;
  private tokenManager: TokenManager;

  constructor(config: any) {
    this.oauthClient = new OAuthClient(config);
    this.tokenManager = new TokenManager();
  }

  async register(server: FastifyInstance) {
    // 添加 preHandler hook
    server.addHook('preHandler', this.authMiddleware.bind(this));

    // 注册路由
    server.get('/oauth/callback', this.handleCallback.bind(this));
    server.get('/api/haier/user', this.getUserInfo.bind(this));
    server.post('/api/haier/logout', this.logout.bind(this));
  }

  /**
   * 认证中间件
   */
  private async authMiddleware(request: FastifyRequest, reply: FastifyReply) {
    if (!this.requiresAuth(request)) {
      return;
    }

    // 尝试从 Header 获取 Token
    const token = this.extractToken(request);

    if (token) {
      const userInfo = await this.oauthClient.verifyToken(token);
      (request as any).haierUser = this.normalizeUser(userInfo, token);
      return;
    }

    // 检查本地 Session
    const session = await this.tokenManager.getSession();

    if (!session || this.tokenManager.isExpired(session)) {
      return reply.code(401).send({
        error: 'authentication_required',
        message: 'Please login first: hccr login'
      });
    }

    // Token 即将过期,尝试刷新
    if (this.tokenManager.needsRefresh(session)) {
      await this.refreshSession(session);
    }

    (request as any).haierUser = {
      userId: session.user_id,
      username: session.username,
      name: session.name,
      email: session.email,
      accessToken: session.access_token
    };
  }

  /**
   * OAuth 回调处理
   */
  private async handleCallback(request: FastifyRequest, reply: FastifyReply) {
    const { code } = request.query as { code: string };

    const tokenResponse = await this.oauthClient.exchangeCodeForToken(code);
    const userInfo = await this.oauthClient.getUserInfo(tokenResponse.access_token);

    const session = {
      user_id: userInfo.user_id,
      username: userInfo.username,
      name: userInfo.name,
      email: userInfo.email,
      department: userInfo.department,
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: Date.now() + tokenResponse.expires_in * 1000
    };

    await this.tokenManager.saveSession(session);

    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
        <head><title>Login Successful</title></head>
        <body>
          <h1>✓ Login Successful!</h1>
          <p>Welcome, <strong>${session.name}</strong>!</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
  }

  private requiresAuth(request: FastifyRequest): boolean {
    return (
      request.url.startsWith('/v1/messages') ||
      request.url.startsWith('/api/haier')
    );
  }

  private extractToken(request: FastifyRequest): string | null {
    const authHeader = request.headers.authorization;
    return authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  }

  private normalizeUser(userInfo: any, token: string) {
    return {
      userId: userInfo.user_id,
      username: userInfo.username,
      name: userInfo.name,
      email: userInfo.email,
      accessToken: token
    };
  }

  private async refreshSession(session: any) {
    const newToken = await this.oauthClient.refreshToken(session.refresh_token);
    session.access_token = newToken.access_token;
    session.refresh_token = newToken.refresh_token;
    session.expires_at = Date.now() + newToken.expires_in * 1000;
    await this.tokenManager.saveSession(session);
  }
}
```

**src/enterprise/oauth/client.ts:**

```typescript
import axios from 'axios';

export class OAuthClient {
  constructor(private config: any) {}

  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.config.client_id,
      redirect_uri: this.config.callback_url,
      response_type: 'code',
      scope: 'user:read profile:read'
    });

    return `${this.config.auth_url}/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string) {
    const response = await axios.post(this.config.token_url, {
      grant_type: 'authorization_code',
      code,
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
      redirect_uri: this.config.callback_url
    });

    return response.data;
  }

  async refreshToken(refreshToken: string) {
    const response = await axios.post(this.config.token_url, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.client_id,
      client_secret: this.config.client_secret
    });

    return response.data;
  }

  async getUserInfo(accessToken: string) {
    const response = await axios.get(this.config.user_info_url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    return response.data;
  }

  async verifyToken(accessToken: string) {
    return this.getUserInfo(accessToken);
  }
}
```

**src/enterprise/oauth/token-manager.ts:**

```typescript
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const SESSION_FILE = path.join(
  process.env.HOME || '',
  '.claude-code-router',
  '.haier-session'
);

export class TokenManager {
  private encryptionKey: string;

  constructor() {
    this.encryptionKey = process.env.HAIER_ENCRYPTION_KEY ||
      crypto.randomBytes(32).toString('hex');
  }

  async saveSession(session: any): Promise<void> {
    const encrypted = this.encrypt(JSON.stringify(session));
    await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });
    await fs.writeFile(SESSION_FILE, encrypted, 'utf8');
  }

  async getSession(): Promise<any | null> {
    try {
      const encrypted = await fs.readFile(SESSION_FILE, 'utf8');
      const decrypted = this.decrypt(encrypted);
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  }

  async clearSession(): Promise<void> {
    try {
      await fs.unlink(SESSION_FILE);
    } catch {}
  }

  isExpired(session: any): boolean {
    return Date.now() >= session.expires_at;
  }

  needsRefresh(session: any): boolean {
    return Date.now() >= session.expires_at - 5 * 60 * 1000;
  }

  private encrypt(text: string): string {
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey, 'hex'),
      Buffer.alloc(16, 0)
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  private decrypt(encrypted: string): string {
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey, 'hex'),
      Buffer.alloc(16, 0)
    );
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
```

### 4.2 配额管理适配器

**src/adapters/quota.adapter.ts:**

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { IAdapter } from './types';
import { QuotaChecker } from '../enterprise/quota/checker';
import { QuotaCalculator } from '../enterprise/quota/calculator';

export class QuotaAdapter implements IAdapter {
  private checker: QuotaChecker;
  private calculator: QuotaCalculator;

  constructor(config: any) {
    this.checker = new QuotaChecker(config);
    this.calculator = new QuotaCalculator();
  }

  async register(server: FastifyInstance) {
    // 请求前检查配额
    server.addHook('preHandler', this.checkQuota.bind(this));

    // 请求后扣除配额
    server.addHook('onSend', this.deductQuota.bind(this));

    // 添加配额查询端点
    server.get('/api/haier/quota', this.getQuota.bind(this));
  }

  /**
   * 配额检查中间件
   */
  private async checkQuota(request: FastifyRequest, reply: FastifyReply) {
    if (!request.url.startsWith('/v1/messages')) {
      return;
    }

    const user = (request as any).haierUser;
    if (!user) {
      return;
    }

    // 获取目标 provider
    const provider = await this.resolveProvider(request, (server as any).config);

    if (provider.source === 'user' || provider.quota_enabled === false) {
      console.log(`[QuotaAdapter] Skipping quota for ${provider.source} provider`);
      (request as any).quotaContext = { quota_enabled: false, provider };
      return;
    }

    // 预估配额
    const estimatedCredits = this.calculator.estimate(
      request.body,
      provider
    );

    // 检查配额
    const { allowed, quota } = await this.checker.check(
      user.userId,
      user.accessToken,
      estimatedCredits
    );

    if (!allowed) {
      return reply.code(429).send({
        error: {
          type: 'quota_exceeded',
          message: 'Your quota has been exceeded',
          quota
        }
      });
    }

    (request as any).quotaContext = {
      quota_enabled: true,
      estimatedCredits,
      provider,
      startTime: Date.now()
    };
  }

  /**
   * 配额扣除 (异步)
   */
  private async deductQuota(request: any, reply: any, payload: any) {
    if (!request.url.startsWith('/v1/messages')) {
      return payload;
    }

    const user = request.haierUser;
    const quotaContext = request.quotaContext;

    if (!user || !quotaContext || !quotaContext.quota_enabled) {
      return payload;
    }

    // 异步扣除,不阻塞响应
    setImmediate(async () => {
      try {
        const usage = this.extractUsage(payload);
        if (!usage) return;

        const actualCredits = this.calculator.calculate(
          usage,
          quotaContext.provider
        );

        await this.checker.deduct(
          user.userId,
          user.accessToken,
          actualCredits,
          {
            provider: quotaContext.provider.name,
            duration_ms: Date.now() - quotaContext.startTime
          }
        );
      } catch (err) {
        console.error('[QuotaAdapter] Failed to deduct quota:', err);
      }
    });

    return payload;
  }

  private async resolveProvider(request: any, config: any) {
    // 从路由逻辑解析 provider
    // 简化实现,实际需要调用 router.ts
    const model = request.body.model || 'default';
    const [providerName] = model.split(',');
    return config.Providers.find((p: any) => p.name === providerName);
  }

  private extractUsage(payload: any): any {
    try {
      const data = JSON.parse(payload.toString());
      return data.usage;
    } catch {
      return null;
    }
  }
}
```

**src/enterprise/quota/calculator.ts:**

```typescript
export class QuotaCalculator {
  /**
   * 预估配额消耗
   */
  estimate(requestBody: any, provider: any): number {
    const inputTokens = this.countInputTokens(requestBody);
    const estimatedOutputTokens = 1000;  // 默认预估

    const weight = provider.quota_weights?.[requestBody.model] || 1.0;
    return Math.ceil(weight * (inputTokens + estimatedOutputTokens));
  }

  /**
   * 计算实际消耗
   */
  calculate(usage: any, provider: any): number {
    const totalTokens = usage.input_tokens + usage.output_tokens;
    const weight = provider.quota_weights?.[usage.model] || 1.0;
    return Math.ceil(weight * totalTokens);
  }

  private countInputTokens(requestBody: any): number {
    // 简化实现,实际使用 tiktoken
    let text = '';
    if (requestBody.system) text += requestBody.system;
    if (requestBody.messages) {
      for (const msg of requestBody.messages) {
        if (typeof msg.content === 'string') {
          text += msg.content;
        }
      }
    }
    return Math.ceil(text.length / 4);  // 粗略估算
  }
}
```

### 4.3 行为上报适配器

**src/adapters/analytics.adapter.ts:**

```typescript
import { FastifyInstance } from 'fastify';
import { IAdapter } from './types';
import { EventCollector } from '../enterprise/analytics/collector';
import { EventReporter } from '../enterprise/analytics/reporter';

export class AnalyticsAdapter implements IAdapter {
  private collector: EventCollector;
  private reporter: EventReporter;

  constructor(config: any) {
    this.collector = new EventCollector();
    this.reporter = new EventReporter(config);
  }

  async register(server: FastifyInstance) {
    // 启动上报器
    this.reporter.start();

    // 请求开始
    server.addHook('preHandler', async (request: any) => {
      if (request.url.startsWith('/v1/messages')) {
        const user = request.haierUser;
        if (user) {
          request.analyticsStartTime = Date.now();
          await this.collector.collect('request_start', user.userId, {
            model: request.body.model
          });
        }
      }
    });

    // 请求完成
    server.addHook('onSend', async (request: any, reply: any, payload: any) => {
      if (request.url.startsWith('/v1/messages')) {
        const user = request.haierUser;
        const startTime = request.analyticsStartTime;

        if (user && startTime) {
          setImmediate(async () => {
            try {
              const usage = this.extractUsage(payload);
              await this.collector.collect('request_complete', user.userId, {
                model: request.body.model,
                duration_ms: Date.now() - startTime,
                input_tokens: usage?.input_tokens,
                output_tokens: usage?.output_tokens
              });
            } catch (err) {
              console.error('[AnalyticsAdapter] Failed to collect:', err);
            }
          });
        }
      }
      return payload;
    });
  }

  async cleanup() {
    await this.reporter.stop();
  }

  private extractUsage(payload: any): any {
    try {
      return JSON.parse(payload.toString()).usage;
    } catch {
      return null;
    }
  }
}
```

**src/enterprise/analytics/queue.ts:**

```typescript
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(
  process.env.HOME || '',
  '.claude-code-router',
  'events.db'
);

export class EventQueue {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        retries INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_status ON event_queue(status);
    `);
  }

  async enqueue(event: any): Promise<void> {
    this.db.prepare(`
      INSERT INTO event_queue (event_id, event_type, event_data, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      event.event_id,
      event.event_type,
      JSON.stringify(event),
      Date.now()
    );
  }

  async dequeue(limit: number = 10): Promise<any[]> {
    const rows = this.db.prepare(`
      SELECT * FROM event_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit);

    return rows.map((row: any) => JSON.parse(row.event_data));
  }

  async markProcessed(eventIds: string[]): Promise<void> {
    const placeholders = eventIds.map(() => '?').join(',');
    this.db.prepare(`
      DELETE FROM event_queue WHERE event_id IN (${placeholders})
    `).run(...eventIds);
  }

  close() {
    this.db.close();
  }
}
```

### 4.4 模型同步适配器

**src/enterprise/models/merger.ts:**

```typescript
export type MergeStrategy = 'auto' | 'haier-first' | 'user-first' | 'haier-only' | 'user-only';

export class ConfigMerger {
  constructor(private strategy: MergeStrategy = 'auto') {}

  merge(userProviders: any[], haierModels: any[]): any[] {
    switch (this.strategy) {
      case 'auto':
        return this.mergeAuto(userProviders, haierModels);
      case 'haier-only':
        return this.convertHaierModels(haierModels);
      case 'user-only':
        return userProviders.map(p => ({ ...p, quota_enabled: false }));
      default:
        return this.mergeAuto(userProviders, haierModels);
    }
  }

  private mergeAuto(userProviders: any[], haierModels: any[]): any[] {
    const result: any[] = [];
    const nameSet = new Set<string>();

    // 用户模型优先
    for (const userProvider of userProviders) {
      result.push({ ...userProvider, source: 'user', quota_enabled: false });
      nameSet.add(userProvider.name);
    }

    // 添加海尔模型 (跳过重名)
    for (const haierModel of haierModels) {
      if (!nameSet.has(haierModel.provider_name)) {
        result.push(this.convertHaierModel(haierModel));
      }
    }

    return result;
  }

  private convertHaierModel(haierModel: any): any {
    return {
      name: haierModel.provider_name,
      source: 'haier',
      api_base_url: haierModel.api_base_url,
      api_key: haierModel.api_key,
      models: haierModel.models.map((m: any) => m.model_name),
      transformer: haierModel.transformer,
      quota_enabled: true,
      quota_weights: haierModel.models.reduce((acc: any, m: any) => {
        acc[m.model_name] = m.quota_weight;
        return acc;
      }, {})
    };
  }

  private convertHaierModels(haierModels: any[]): any[] {
    return haierModels.map(m => this.convertHaierModel(m));
  }
}
```

### 4.5 主服务集成

**src/index.ts (改造):**

```typescript
import { AdapterManager } from './adapters';

export async function run() {
  // 读取配置
  const config = await readConfigFile();

  // 创建服务器
  const server = await createServer(config);

  // 新增:注册企业适配器
  const adapterManager = new AdapterManager();
  await adapterManager.register(server, config);

  // 挂载到 server
  (server as any).adapterManager = adapterManager;

  // 启动服务器
  await server.listen({ port: config.PORT, host: config.HOST });

  // 保存 PID
  savePid(process.pid);

  // 进程退出处理
  const cleanup = async () => {
    console.log('Shutting down...');
    await adapterManager.cleanup();
    await server.close();
    cleanupPidFile();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return server;
}
```

---

## 5. 数据库设计

### 5.1 本地 SQLite (事件队列)

**src/database/schema.sql:**

```sql
-- 事件队列表
CREATE TABLE IF NOT EXISTS event_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  retries INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending'  -- pending, processing, failed
);

CREATE INDEX IF NOT EXISTS idx_event_queue_status ON event_queue(status);
CREATE INDEX IF NOT EXISTS idx_event_queue_created_at ON event_queue(created_at);
```

### 5.2 后台 PostgreSQL

**用户表:**
```sql
CREATE TABLE users (
  user_id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  name VARCHAR(100),
  email VARCHAR(255),
  department VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**模型表:**
```sql
CREATE TABLE models (
  model_id VARCHAR(64) PRIMARY KEY,
  provider_name VARCHAR(100) NOT NULL,
  model_name VARCHAR(100) NOT NULL,
  api_base_url TEXT,
  quota_weight DECIMAL(10, 2),
  status VARCHAR(20) DEFAULT 'active'
);
```

**配额表:**
```sql
CREATE TABLE quotas (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(64) REFERENCES users(user_id),
  total_credits BIGINT NOT NULL,
  used_credits BIGINT DEFAULT 0,
  remaining_credits BIGINT GENERATED ALWAYS AS (total_credits - used_credits) STORED,
  valid_from TIMESTAMP,
  valid_until TIMESTAMP
);
```

**使用记录表:**
```sql
CREATE TABLE usage_records (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(64) REFERENCES users(user_id),
  model_id VARCHAR(64),
  input_tokens INTEGER,
  output_tokens INTEGER,
  credits_consumed BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**事件表:**
```sql
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(64) UNIQUE NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  user_id VARCHAR(64) REFERENCES users(user_id),
  event_data JSONB,
  timestamp TIMESTAMP NOT NULL
);

CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_timestamp ON events(timestamp);
```

---

## 6. 部署方案

### 6.1 本地服务部署

**开源模式:**
```bash
npm install -g @haier/claude-code-router
hhccr start
hhccr code
```

**企业模式:**
```bash
npm install -g @haier/claude-code-router

# 配置企业功能
cat > ~/.claude-code-router/config.json <<EOF
{
  "HAIER_ENTERPRISE_MODE": true,
  "HAIER_OAUTH": {...},
  "HAIER_QUOTA": {...}
}
EOF

hccr login
hccr start
hccr code
```

### 6.2 后台服务部署

**服务拆分:**
```
haier-ccr-auth       → 认证服务 (OAuth)
haier-ccr-model      → 模型管理服务
haier-ccr-quota      → 配额管理服务
haier-ccr-analytics  → 数据分析服务
haier-ccr-admin      → 管理后台
```

**部署架构:**
```
┌─────────────────────────────────────────┐
│           API Gateway (Nginx)           │
└───────────┬─────────────────────────────┘
            │
    ┌───────┴───────┐
    │               │
┌───▼───┐      ┌───▼───┐
│ Auth  │      │ Model │
│ Svc   │      │ Svc   │
└───┬───┘      └───┬───┘
    │              │
┌───▼──────────────▼───┐
│   PostgreSQL Cluster │
└──────────────────────┘
┌──────────────────────┐
│    Redis Cluster     │
└──────────────────────┘
```

---

## 7. 模型上下文大小自动压缩

### 7.1 功能概述

为了优化不同上下文大小模型的自动压缩行为，系统支持为每个模型配置上下文大小（单位：K），并自动计算 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 环境变量。

### 7.2 配置结构

**Provider 配置扩展:**

```typescript
interface Provider {
  name: string;
  api_base_url: string;
  api_key: string;
  models: string[];
  transformer?: TransformerConfig;
  contextSize?: Record<string, number>; // 新增：模型上下文大小配置
}
```

**配置示例:**

```json
{
  "Providers": [
    {
      "name": "minimax",
      "api_base_url": "https://api.minimax.chat/v1/chat/completions",
      "api_key": "sk-xxx",
      "models": ["minimax-m2"],
      "contextSize": {
        "minimax-m2": 120
      }
    },
    {
      "name": "deepseek",
      "api_base_url": "https://api.deepseek.com/chat/completions",
      "api_key": "sk-xxx",
      "models": ["deepseek-chat"],
      "contextSize": {
        "deepseek-chat": 64
      }
    }
  ],
  "Router": {
    "default": "minimax,minimax-m2"
  }
}
```

### 7.3 计算逻辑

**公式:**

```
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = (当前模型上下文大小 / 200) * 0.8
```

- **200K**: Claude 官方模型的上下文大小基准
- **0.8**: 80% 的压缩阈值（与 Claude 官方相同）

**实现代码 (src/utils/createEnvVariables.ts):**

```typescript
const calculateAutoCompactPct = (modelContextSize: number): number => {
  const claudeContextSize = 200; // Claude 官方上下文大小
  return (modelContextSize / claudeContextSize) * 0.8;
};

const getModelContextSize = (config: any, modelKey: string): number | undefined => {
  if (!modelKey) return undefined;
  
  const [providerName, modelName] = modelKey.split(',');
  if (!providerName || !modelName) return undefined;
  
  const provider = config.Providers?.find((p: any) => p.name === providerName);
  if (!provider || !provider.contextSize) return undefined;
  
  return provider.contextSize[modelName];
};

export const createEnvVariables = async () => {
  const config = await readConfigFile();
  const envVars: Record<string, string | undefined> = {
    // ... 其他环境变量
  };

  // 计算并设置 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  const defaultModel = config.Router?.default;
  if (defaultModel) {
    const contextSize = getModelContextSize(config, defaultModel);
    if (contextSize) {
      const autoCompactPct = calculateAutoCompactPct(contextSize);
      envVars.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = autoCompactPct.toFixed(2);
      console.log(`Setting CLAUDE_AUTOCOMPACT_PCT_OVERRIDE to ${autoCompactPct.toFixed(2)} (based on ${contextSize}K context)`);
    }
  }

  return envVars;
};
```

### 7.4 计算示例

| 模型 | 上下文大小 | 计算过程 | 压缩阈值 | 说明 |
|------|-----------|---------|---------|------|
| minimax-m2 | 120K | (120/200) * 0.8 | 0.48 (48%) | 小上下文模型，提前压缩 |
| deepseek-chat | 64K | (64/200) * 0.8 | 0.256 (25.6%) | 更小上下文，更早压缩 |
| gemini-2.5-pro | 1000K | (1000/200) * 0.8 | 4.0 (400%) | 大上下文模型，延迟压缩 |
| claude-sonnet-4 | 200K | (200/200) * 0.8 | 0.8 (80%) | 标准 Claude 模型 |

### 7.5 交互式配置

**模型选择器集成 (src/utils/modelSelector.ts):**

在 `hccr model` 命令中添加上下文大小配置：

```typescript
// 添加新模型时
const contextSizeInput = await input({
  message: `\n${BOLDYELLOW}Enter the model context size in K (e.g., 120 for 120K, leave empty to skip):${RESET}`,
  default: '',
  validate: (value: string) => {
    if (value.trim() === '') return true;
    const num = parseInt(value);
    if (isNaN(num) || num <= 0) {
      return 'Please enter a valid positive number or leave empty';
    }
    return true;
  }
});

if (contextSizeInput.trim() !== '') {
  if (!provider.contextSize) {
    provider.contextSize = {};
  }
  provider.contextSize[modelName] = parseInt(contextSizeInput);
}
```

### 7.6 使用场景

**场景1: 小上下文模型节省成本**

使用 64K 上下文的模型时，系统自动设置压缩阈值为 25.6%，确保不会过早触发压缩，避免频繁的上下文重建。

**场景2: 大上下文模型处理长文本**

使用 1000K 上下文的模型时，系统设置压缩阈值为 400%，充分利用模型的长上下文能力，减少压缩次数。

**场景3: 多模型动态切换**

当使用 `/model` 命令切换模型时，系统根据当前 default 模型的配置自动调整压缩行为，无需手动干预。

### 7.7 技术特性

**向后兼容:**
- `contextSize` 为可选字段
- 不配置时使用默认行为
- 不影响现有配置

**性能优化:**
- 配置读取时一次性计算
- 结果缓存在环境变量中
- 无运行时性能开销

**错误处理:**
- 配置格式错误时静默跳过
- 模型未找到时使用默认值
- 保证服务正常启动

---

## 8. 关键技术点

### 8.1 非侵入式实现

**通过 Fastify Hooks 插入:**
```typescript
// 不修改原有代码
// 在 preHandler 阶段插入认证和配额检查
server.addHook('preHandler', authMiddleware);
server.addHook('preHandler', quotaMiddleware);

// 在 onSend 阶段插入配额扣除和数据上报
server.addHook('onSend', quotaDeductHook);
server.addHook('onSend', analyticsReportHook);
```

### 8.2 异步非阻塞

**关键操作异步化:**
```typescript
// 配额扣除不阻塞响应
setImmediate(async () => {
  await quotaChecker.deduct(userId, credits);
});

// 数据上报不阻塞响应
setImmediate(async () => {
  await analyticsCollector.report(event);
});
```

### 8.3 配置驱动

**一键切换模式:**
```json
{
  "HAIER_ENTERPRISE_MODE": false  // 开源模式
}
```

```json
{
  "HAIER_ENTERPRISE_MODE": true   // 企业模式
}
```

### 8.4 向下兼容

**原有配置完全兼容:**
```json
{
  "PORT": 3456,
  "Providers": [...],
  "Router": {...}
}
```

无需修改即可运行。

---

## 9. 性能优化

### 9.1 缓存策略

- **配额缓存**: LRU, TTL 5 分钟
- **模型缓存**: 本地文件, TTL 1 小时
- **Token 缓存**: 加密本地文件

### 9.2 批量操作

- **事件上报**: 批量 10 条或 30 秒
- **配额查询**: 批量查询,减少请求

### 9.3 异步处理

- **配额扣除**: 异步,不阻塞响应
- **数据上报**: 异步,本地队列
- **模型同步**: 后台定时任务

---

## 10. 安全设计

### 10.1 Token 安全

- 加密存储 (AES-256-CBC)
- 自动刷新机制
- 过期重新登录

### 10.2 API Key 保护

- 企业模型 Key 不暴露给用户
- 用户模型 Key 本地加密
- 支持环境变量引用

### 10.3 配额防绕过

- 来源标记 (`source: 'haier' | 'user'`)
- 企业模型强制配额检查
- 用户无法修改 `quota_enabled` 标记

---

## 11. 监控与告警

### 11.1 监控指标

- 服务健康状态
- 请求成功率
- 平均响应时间
- 配额使用率
- 错误率

### 11.2 日志收集

- 本地日志: `~/.claude-code-router/logs/`
- 日志轮转: 3 文件, 50MB 上限
- 级别: debug, info, warn, error

### 11.3 告警策略

- 服务宕机告警
- 配额超限告警
- 错误率异常告警

---

## 总结

通过适配器模式,我们实现了:

✅ **非侵入式改造**: 不修改原有代码,通过 Hooks 扩展
✅ **可插拔设计**: 企业功能可完全禁用
✅ **高性能**: 异步非阻塞,不影响原有性能
✅ **安全可靠**: Token 加密,配额防绕过
✅ **向下兼容**: 支持开源/企业模式平滑切换
