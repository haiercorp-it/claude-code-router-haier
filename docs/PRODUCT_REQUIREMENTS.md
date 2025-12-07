# 海尔 Claude Code Router 产品化需求文档

## 文档信息
- **版本**: v1.0
- **创建日期**: 2025-12-03
- **产品定位**: 基于开源 Claude Code Router 的企业级 AI 编程助手

---

## 目录

1. [产品概述](#1-产品概述)
2. [核心需求](#2-核心需求)
3. [功能设计](#3-功能设计)
4. [用户体验](#4-用户体验)
5. [数据与配额](#5-数据与配额)
6. [实施计划](#6-实施计划)

---

## 1. 产品概述

### 1.1 背景

Claude Code Router 是一个开源项目,允许用户将 Claude Code 的请求路由到不同的 LLM 提供商。我们计划基于此项目开发海尔内部的企业级编程工具。

**核心原则**: 保持开源版本功能完整性,通过适配层增加企业能力。

### 1.2 产品目标

| 目标 | 说明 |
|------|------|
| **企业统一管控** | 通过海尔账号中心登录,统一身份认证 |
| **成本可控** | 配额管理,控制模型使用成本 |
| **数据洞察** | 完整的使用数据分析,支持决策 |
| **灵活扩展** | 用户既能使用企业模型,也能添加私有模型 |
| **向下兼容** | 完全兼容开源版本,可随时切换 |

### 1.3 目标用户

- **海尔研发人员**: 使用企业统一提供的 AI 编程助手
- **个人开发者**: 可添加自己的模型和 API Key
- **团队管理者**: 查看团队使用情况和成本

---

## 2. 核心需求

### 2.1 海尔账号中心登录

#### 需求描述
用户通过海尔统一身份认证系统(OAuth 2.0)登录,无需手动配置 API Key。

#### 功能要求

**基础功能:**
- 支持 OAuth 2.0 授权码模式
- 弹出浏览器完成登录
- 自动获取用户信息(姓名、邮箱、部门)
- Token 自动刷新机制
- 登录状态持久化

**CLI 命令:**
```bash
ccr login    # 打开浏览器登录
ccr logout   # 登出
ccr whoami   # 查看当前用户
```

**UI 展示:**
- 顶部显示当前登录用户
- 登录/登出按钮
- Token 过期提醒

#### 用户体验

**首次使用流程:**
```
1. 用户执行 ccr start 或 ccr code
2. 检测到未登录,提示: "Please login first: ccr login"
3. 用户执行 ccr login
4. 自动打开浏览器,跳转到海尔登录页
5. 用户输入账号密码,授权
6. 浏览器显示 "Login Successful",3 秒后自动关闭
7. 终端显示: "✓ Login successful! Welcome, 张三!"
8. 用户可以正常使用: ccr code
```

**Token 过期处理:**
```
1. 检测到 Token 即将过期(提前 5 分钟)
2. 自动使用 refresh_token 刷新
3. 刷新失败时提示: "Session expired. Please login again: ccr login"
```

---

### 2.2 混合模型管理

#### 需求描述
用户既能使用海尔统一下发的企业模型,也能自由添加私有模型(本地 Ollama、个人 API Key 等)。

#### 核心设计

**模型来源:**
```
海尔企业模型 (后台下发)          用户自定义模型 (本地配置)
      ↓                              ↓
  消耗企业配额                    无配额限制
  统一管理                        自由添加
  API Key 加密                    用户自己的 Key
```

**配置示例:**
```json
{
  "HAIER_ENTERPRISE_MODE": true,

  // 用户自定义模型 (自由添加)
  "Providers": [
    {
      "name": "my-ollama",
      "source": "user",
      "api_base_url": "http://localhost:11434/v1/chat/completions",
      "models": ["qwen2.5-coder:14b"]
    },
    {
      "name": "my-deepseek",
      "source": "user",
      "api_key": "$MY_DEEPSEEK_KEY",
      "models": ["deepseek-chat"]
    }
  ],

  // 可以混用企业模型和用户模型
  "Router": {
    "default": "haier-deepseek,deepseek-chat",    // 企业模型,消耗配额
    "background": "my-ollama,qwen2.5-coder:14b",  // 用户模型,不限配额
    "think": "haier-deepseek,deepseek-r1"         // 企业模型
  }
}
```

#### 合并策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **auto** (默认) | 海尔 + 用户,去重,用户优先 | 大多数场景 |
| **haier-first** | 海尔优先,用户补充 | 企业严格管控 |
| **user-first** | 用户优先,海尔补充 | 用户完全控制 |
| **haier-only** | 仅海尔模型 | 纯企业场景 |
| **user-only** | 仅用户模型 | 测试/离线环境 |

#### 使用场景

**场景 1: 企业用户 + 本地 Ollama**
- 日常开发用企业模型(消耗配额)
- 后台任务用本地 Ollama(不限配额,快速)

**场景 2: 用户自己的 API Key**
- 添加自己的 OpenAI/DeepSeek Key
- 不消耗企业配额,费用自理

**场景 3: 混合使用**
- 简单任务用企业 Flash 模型
- 复杂任务用自己的 GPT-4
- 推理任务用企业 DeepSeek-R1

---

### 2.3 配额管理

#### 需求描述
基于模型权重和 Token 数量进行配额管理,控制使用成本。

#### 配额计算公式

```
配额消耗 = 模型权重 × Token 数量

示例:
- deepseek-chat: 权重 2.0
- gemini-flash: 权重 1.5
- deepseek-r1: 权重 3.0

实际消耗:
使用 deepseek-chat,输入 1000 tokens,输出 500 tokens
配额消耗 = 2.0 × (1000 + 500) = 3000 点
```

#### 配额分配

| 用户类型 | 初始配额 | 说明 |
|---------|---------|------|
| 新用户 | 10,000 点 | 试用配额 |
| 标准用户 | 50,000 点 | 月度配额 |
| 高级用户 | 100,000 点 | 月度配额 |

#### 配额检查流程

```
1. 请求前: 预估配额 = 权重 × (输入 tokens + 预估输出 tokens)
2. 检查: 剩余配额 >= 预估配额 ?
3. 允许: 继续请求
4. 拒绝: 返回 429 错误
5. 请求后: 实际消耗 = 权重 × (实际输入 + 实际输出)
6. 扣除: 剩余配额 -= 实际消耗
```

#### 用户体验

**配额充足:**
- 正常使用,无提示

**配额不足 (90%):**
- 警告: "⚠️  Quota usage: 92%. Remaining: 8,000 credits"
- 继续允许使用

**配额耗尽 (100%):**
- 拒绝请求,返回错误
- 提示: "❌ Quota exceeded. Contact admin or use your own models"
- 用户可切换到私有模型继续使用

**CLI 命令:**
```bash
ccr quota  # 查看配额状态

输出:
Quota Status:
  Total:     50,000 credits
  Used:      32,500 credits
  Remaining: 17,500 credits
  Usage:     65.00%
  [=============================---------------------]
```

**UI 展示:**
```
┌─────────────────────────────────────────┐
│ Quota Status                            │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ [██████████████████░░░░░░░░░░] 65%     │
│ Used: 32,500 / 50,000 credits           │
└─────────────────────────────────────────┘
```

#### 配额规则

**企业模型:**
- ✅ 消耗配额
- ✅ 配额检查
- ✅ 配额扣除

**用户私有模型:**
- ❌ 不消耗配额
- ❌ 不检查配额
- ❌ 无使用限制

---

### 2.4 用户行为上报

#### 需求描述
采集用户使用数据,用于产品优化和成本分析。

#### 数据采集范围

**基础事件:**
- 用户登录/登出
- 服务启动/停止
- 模型切换

**使用事件:**
- 请求开始/完成/失败
- 模型使用情况
- Token 消耗量
- 响应时间

**错误事件:**
- 请求失败
- 配额超限
- 认证失败

#### 数据字段

```json
{
  "event_id": "uuid",
  "event_type": "request_complete",
  "timestamp": "2025-12-03T10:30:45.123Z",
  "user_id": "haier_user_12345",
  "session_id": "session_uuid",

  "event_data": {
    "provider": "haier-deepseek",
    "model": "deepseek-chat",
    "input_tokens": 1500,
    "output_tokens": 920,
    "credits_consumed": 4840,
    "duration_ms": 3200,
    "status": "success"
  },

  "context": {
    "version": "1.0.71",
    "platform": "darwin",
    "os_version": "24.6.0"
  }
}
```

#### 上报机制

- **异步上报**: 不阻塞主流程
- **批量上报**: 每 30 秒或 10 条
- **本地队列**: SQLite 持久化,防止数据丢失
- **失败重试**: 最多 3 次

#### 隐私保护

- ✅ 不上报用户输入内容(仅上报长度)
- ✅ 不上报 API Key
- ✅ 不上报完整提示词
- ✅ 脱敏处理敏感信息
- ✅ 支持用户退出数据采集

---

### 2.5 Usage 对接与 Auto-Compact

#### 需求描述
适配不同 LLM 提供商的 Usage 格式,确保 Claude Code 的 auto-compact 功能正常工作。

#### Auto-Compact 机制

Claude Code 会在上下文接近 token 限制时,自动压缩历史消息:

```
触发条件: 总 token > 模型限制 × 70%
依赖数据: usage { input_tokens, output_tokens }
```

#### 提供商适配

**Anthropic Claude:**
```json
{
  "usage": {
    "input_tokens": 1500,
    "output_tokens": 920
  }
}
```

**OpenAI-Compatible:**
```json
{
  "usage": {
    "prompt_tokens": 1500,
    "completion_tokens": 920
  }
}
// 映射: input_tokens = prompt_tokens
```

**Gemini:**
```json
{
  "usageMetadata": {
    "promptTokenCount": 1500,
    "candidatesTokenCount": 920
  }
}
// 映射: input_tokens = promptTokenCount
```

**无 Usage 支持 (Ollama 等):**
- 使用 tiktoken 本地计算
- 流式响应中累计计算

#### 实现要求

- 在 Transformer 层统一适配
- 流式响应中发送 Usage 事件
- 确保 Claude Code 能正确读取

---

## 3. 功能设计

### 3.1 功能模块

```
┌─────────────────────────────────────────────────────────┐
│                   海尔 CCR 产品功能                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ 身份认证    │  │ 模型管理    │  │ 配额管理    │   │
│  │             │  │             │  │             │   │
│  │ • OAuth登录 │  │ • 企业模型  │  │ • 配额检查  │   │
│  │ • Token管理 │  │ • 用户模型  │  │ • 配额扣除  │   │
│  │ • 状态查询  │  │ • 自动同步  │  │ • 配额查询  │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ 数据上报    │  │ UI 界面     │  │ CLI 工具    │   │
│  │             │  │             │  │             │   │
│  │ • 事件采集  │  │ • 配置管理  │  │ • 命令扩展  │   │
│  │ • 批量上报  │  │ • 模型展示  │  │ • 状态查询  │   │
│  │ • 本地队列  │  │ • 配额展示  │  │ • 日志查看  │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 企业模式开关

用户可以通过配置控制是否启用企业功能:

```json
{
  "HAIER_ENTERPRISE_MODE": false  // 开源模式,完全兼容
}
```

```json
{
  "HAIER_ENTERPRISE_MODE": true,  // 企业模式
  "HAIER_OAUTH": { "enabled": true },
  "HAIER_QUOTA": { "enabled": true },
  "HAIER_ANALYTICS": { "enabled": true },
  "HAIER_MODEL_SYNC": { "enabled": true }
}
```

每个企业功能都可以独立启用/禁用。

---

## 4. 用户体验

### 4.1 新用户上手流程

```
1. 安装
   npm install -g @haier/claude-code-router

2. 首次启动
   ccr start
   → 提示: "Please login first: ccr login"

3. 登录
   ccr login
   → 打开浏览器
   → 输入海尔账号密码
   → 授权成功
   → 终端显示: "✓ Login successful! Welcome, 张三!"

4. 查看可用模型
   ccr models
   → 显示企业模型清单

5. 开始使用
   ccr code
   → 正常使用 Claude Code,请求自动路由到企业模型
```

### 4.2 日常使用流程

```
# 启动服务
ccr start

# 使用 Claude Code
ccr code "帮我优化这段代码"

# 查看配额
ccr quota
  Total:     50,000 credits
  Used:      12,500 credits
  Remaining: 37,500 credits

# 切换模型
ccr model
  → 交互式选择器

# 查看状态
ccr status
  Service: Running
  User: 张三 (zhangsan@haier.com)
  Quota: 75% remaining
```

### 4.3 UI 界面

**主界面布局:**
```
┌────────────────────────────────────────────────────────┐
│ 海尔 Claude Code Router    [张三] [Quota: 75%] [登出] │
├────────────────────────────────────────────────────────┤
│                                                        │
│ ┌─────────────────┐  ┌────────────────────────────┐  │
│ │ 企业模型 (3)    │  │ 我的模型 (2)                │  │
│ │                 │  │                            │  │
│ │ • DeepSeek Chat │  │ • my-ollama                │  │
│ │ • DeepSeek R1   │  │ • my-deepseek              │  │
│ │ • Gemini Flash  │  │                            │  │
│ └─────────────────┘  └────────────────────────────┘  │
│                                                        │
│ ┌──────────────────────────────────────────────────┐  │
│ │ 配额使用情况                                     │  │
│ │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│  │
│ │ [██████████████████░░░░░░░░░░░] 75%            │  │
│ │ 已用: 37,500 / 50,000 credits                  │  │
│ └──────────────────────────────────────────────────┘  │
│                                                        │
│ [同步模型] [添加自定义模型] [查看使用统计]            │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 5. 数据与配额

### 5.1 数据分析维度

**用户维度:**
- 活跃用户数
- 用户登录频率
- 用户配额使用情况

**模型维度:**
- 各模型使用次数
- 各模型 Token 消耗
- 各模型响应时间

**成本维度:**
- 总配额消耗
- 各模型成本分布
- 用户成本排名

**性能维度:**
- 请求成功率
- 平均响应时间
- 错误率统计

### 5.2 配额管理策略

**分配策略:**
- 新用户: 10,000 点试用
- 标准用户: 50,000 点/月
- 月度重置,剩余不累计

**超限处理:**
- 90% 时警告
- 100% 时拒绝企业模型请求
- 允许切换到用户私有模型

**申请流程:**
- 用户提交配额申请
- 管理员审批
- 系统自动分配

---

## 6. 实施计划

### 6.1 开发阶段

| 阶段 | 时间 | 内容 | 交付物 |
|------|------|------|--------|
| Phase 1 | Week 1 | 适配器框架搭建 | 基础架构,可插拔验证 |
| Phase 2 | Week 2 | OAuth 认证 | 登录功能,CLI 命令 |
| Phase 3 | Week 3 | 混合模型管理 | 模型同步,配置合并 |
| Phase 4 | Week 4 | 配额管理 | 配额检查,扣除,查询 |
| Phase 5 | Week 5 | 行为上报 | 事件采集,批量上报 |
| Phase 6 | Week 6 | UI 改造 | 企业功能界面 |
| Phase 7 | Week 7 | 测试与优化 | 全面测试,性能优化 |

### 6.2 验收标准

**功能完整性:**
- ✅ 开源模式: 100% 功能正常
- ✅ 企业模式: 新功能正常工作
- ✅ 模式切换: 平滑无损

**性能指标:**
- ✅ 配额检查延迟 < 50ms
- ✅ 行为上报不阻塞请求
- ✅ 模型同步不影响使用

**兼容性:**
- ✅ 原有配置文件无需修改
- ✅ 支持企业/开源模式切换
- ✅ 向下兼容

---

## 7. 附录

### 7.1 配置示例

**开源模式 (完全兼容):**
```json
{
  "PORT": 3456,
  "APIKEY": "test-key",
  "Providers": [
    {
      "name": "deepseek",
      "api_base_url": "https://api.deepseek.com",
      "api_key": "sk-xxx",
      "models": ["deepseek-chat"]
    }
  ],
  "Router": {
    "default": "deepseek,deepseek-chat"
  }
}
```

**企业模式:**
```json
{
  "PORT": 3456,
  "HAIER_ENTERPRISE_MODE": true,

  "HAIER_OAUTH": {
    "enabled": true,
    "client_id": "ccr_client_id",
    "client_secret": "ccr_secret",
    "auth_url": "https://auth.haier.com",
    "token_url": "https://auth.haier.com/token",
    "user_info_url": "https://auth.haier.com/userinfo",
    "callback_url": "http://127.0.0.1:3456/oauth/callback"
  },

  "HAIER_MODEL_SYNC": {
    "enabled": true,
    "backend_url": "https://ccr-api.haier.net/models",
    "merge_strategy": "auto"
  },

  "HAIER_QUOTA": {
    "enabled": true,
    "backend_url": "https://ccr-api.haier.net/quota"
  },

  "HAIER_ANALYTICS": {
    "enabled": true,
    "backend_url": "https://ccr-api.haier.net/events"
  },

  "Providers": [
    {
      "name": "my-ollama",
      "source": "user",
      "api_base_url": "http://localhost:11434/v1/chat/completions",
      "models": ["qwen2.5-coder:14b"]
    }
  ],

  "Router": {
    "default": "haier-deepseek,deepseek-chat",
    "background": "my-ollama,qwen2.5-coder:14b"
  }
}
```

### 7.2 常见问题

**Q: 企业模式和开源模式有什么区别?**
- 开源模式: 完全本地配置,无认证,无配额限制
- 企业模式: 海尔账号登录,企业模型 + 用户模型,配额管理

**Q: 我可以只启用部分企业功能吗?**
- 可以,每个功能都有独立的 `enabled` 开关

**Q: 用户自定义模型会消耗企业配额吗?**
- 不会,用户模型 (`source: "user"`) 不检查配额

**Q: 如何回退到开源版本?**
- 将 `HAIER_ENTERPRISE_MODE` 设为 `false` 即可

---

## 结语

通过产品化改造,我们将打造一款:
- ✅ **企业可控**: 统一认证、配额管理、使用分析
- ✅ **用户友好**: 灵活扩展、平滑切换、开箱即用
- ✅ **技术先进**: 非侵入式、适配器模式、向下兼容

的企业级 AI 编程助手工具。
