# 海尔 Claude Code Router 文档

## 文档列表

### 1. [产品需求文档](./PRODUCT_REQUIREMENTS.md)
**适合人群**: 产品经理、项目管理者、决策者

**内容概要**:
- 产品概述与目标
- 5 大核心需求详解
  - 海尔账号中心登录
  - 混合模型管理 (企业 + 用户)
  - 配额管理
  - 用户行为上报
  - Usage 对接与 Auto-Compact
- 功能设计与用户体验
- 数据分析与配额策略
- 实施计划与验收标准

**关键亮点**:
- ✅ 企业统一管控 + 用户灵活扩展
- ✅ 开源模式 / 企业模式平滑切换
- ✅ 配额分离: 企业模型消耗配额,用户模型无限制

---

### 2. [技术设计文档](./TECHNICAL_DESIGN.md)
**适合人群**: 开发工程师、架构师、技术负责人

**内容概要**:
- 设计原则: 非侵入式适配层
- 整体架构与目录结构
- 适配器详细实现
  - AuthAdapter (OAuth 认证)
  - QuotaAdapter (配额管理)
  - AnalyticsAdapter (行为上报)
  - ModelAdapter (模型同步)
- 数据库设计 (SQLite + PostgreSQL)
- 部署方案与性能优化

**关键亮点**:
- ✅ 通过 Fastify Hooks 插入,零侵入
- ✅ 异步非阻塞,不影响性能
- ✅ 完整代码实现示例
- ✅ 安全设计与监控方案

---

## 快速导航

### 我是产品经理,想了解需求
👉 阅读 [产品需求文档](./PRODUCT_REQUIREMENTS.md)

### 我是开发人员,想了解实现
👉 阅读 [技术设计文档](./TECHNICAL_DESIGN.md)

### 我想快速了解核心特性
👉 阅读下面的核心特性总结

---

## 核心特性总结

### 1. 双模式运行

```json
// 开源模式 (完全兼容原版)
{
  "HAIER_ENTERPRISE_MODE": false
}
```

```json
// 企业模式 (启用企业功能)
{
  "HAIER_ENTERPRISE_MODE": true,
  "HAIER_OAUTH": { "enabled": true },
  "HAIER_QUOTA": { "enabled": true }
}
```

### 2. 混合模型管理

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
  "Providers": [
    {
      "name": "my-ollama",
      "source": "user",
      "models": ["qwen2.5-coder:14b"]
    }
  ],
  "Router": {
    "default": "haier-deepseek,deepseek-chat",   // 企业模型
    "background": "my-ollama,qwen2.5-coder:14b"  // 用户模型
  }
}
```

### 3. 配额计算

```
配额消耗 = 模型权重 × Token 数量

示例:
- deepseek-chat: 权重 2.0
- 使用 1500 tokens
- 配额消耗 = 2.0 × 1500 = 3000 点
```

### 4. 用户体验

**CLI 命令:**
```bash
ccr login        # OAuth 登录
ccr whoami       # 查看当前用户
ccr quota        # 查看配额状态
ccr code         # 使用 Claude Code
```

**配额展示:**
```
Quota Status:
  Total:     50,000 credits
  Used:      32,500 credits
  Remaining: 17,500 credits
  Usage:     65.00%
  [=============================---------------------]
```

---

## 架构设计

### 适配器模式

```
原有 CCR 核心
     ↓ (通过 Fastify Hooks)
企业适配层
     ↓
后台服务
```

**优势:**
- ✅ 不修改原有代码
- ✅ 企业功能可插拔
- ✅ 异步非阻塞
- ✅ 向下兼容

---

## 实施计划

| 阶段 | 时间 | 交付物 |
|------|------|--------|
| Phase 1 | Week 1 | 适配器框架 |
| Phase 2 | Week 2 | OAuth 认证 |
| Phase 3 | Week 3 | 混合模型管理 |
| Phase 4 | Week 4 | 配额管理 |
| Phase 5 | Week 5 | 行为上报 |
| Phase 6 | Week 6 | UI 改造 |
| Phase 7 | Week 7 | 测试与优化 |

---

## 常见问题

**Q: 企业模式和开源模式有什么区别?**
- 开源模式: 完全本地,无认证,无配额
- 企业模式: OAuth 登录,企业模型,配额管理

**Q: 用户自定义模型会消耗企业配额吗?**
- 不会,用户模型 (`source: "user"`) 无配额限制

**Q: 如何回退到开源版本?**
- 设置 `HAIER_ENTERPRISE_MODE: false` 即可

**Q: 可以只启用部分企业功能吗?**
- 可以,每个功能都有独立的 `enabled` 开关

---

## 联系方式

- 技术支持: [待定]
- 问题反馈: GitHub Issues
- 文档贡献: Pull Request

---

## 更新日志

- **2025-12-03**: 初始版本发布
  - 产品需求文档
  - 技术设计文档
