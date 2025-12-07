# Claude Code Router - 流式响应示例

本示例展示了什么样的模型返回格式能够让 claude-code-router 正确感知 token 数量。

## 概述

Claude Code Router 通过监听模型的**流式响应**中的 `message_delta` 事件来获取 token 使用统计。要让路由器正确感知 token 数量，模型返回必须符合特定的 Server-Sent Events (SSE) 格式。

## 关键要求

1. **必须使用流式响应** (Server-Sent Events)
2. **必须发送 `message_delta` 事件**
3. **事件数据中必须包含 `usage` 字段**
4. **遵循 Anthropic SSE 格式规范**

## 完整示例

下面是一个符合要求的模拟流式响应示例：

```http
POST /v1/messages HTTP/1.1
Content-Type: application/json
Authorization: Bearer your-api-key

{
  "model": "deepseek-chat",
  "max_tokens": 4096,
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "stream": true
}
```

对应的模型响应（流式SSE格式）：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: message_start
data: {"type":"message","id":"msg_123","role":"assistant","content":[],"model":"deepseek-chat","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":15,"output_tokens":0}}

event: content_block_start
data: {"type":"content_block","index":0,"content_block":{"type":"text","text":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"!"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" I"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"'m"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" doing"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" well,"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" thanks"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" for"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" asking!"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":15,"output_tokens":12}}

event: message_stop
data: {"type":"message_stop","stop_reason":"end_turn"}

event: ping
data: {"type":"ping"}
```

## 关键事件解析

### 1. message_start 事件
```json
{
  "type": "message",
  "id": "msg_123",
  "role": "assistant",
  "content": [],
  "model": "deepseek-chat",
  "stop_reason": null,
  "stop_sequence": null,
  "usage": {
    "input_tokens": 15,
    "output_tokens": 0
  }
}
```
- **初始 usage**：显示输入token数（15），输出token数为0

### 2. content_block_* 事件
这些事件携带实际的文本内容：
```json
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "text_delta",
    "text": "Hello"
  }
}
```

### 3. message_delta 事件 ⚠️ **最重要**
```json
{
  "type": "message_delta",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 15,
    "output_tokens": 12
  }
}
```
- **最终 usage**：包含完整的输入和输出token统计
- **Claude Code Router  именно 监听此事件来更新 token 统计**

## 简化版最小示例

如果只需要让路由器感知 token 数量，最小必需的事件序列：

```http
event: message_start
data: {"type":"message","id":"msg_456","role":"assistant","content":[],"model":"test-model","usage":{"input_tokens":20,"output_tokens":0}}

event: content_block_start
data: {"type":"content_block","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Response text here"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","usage":{"input_tokens":20,"output_tokens":17}}

event: message_stop
data: {"type":"message_stop"}
```

## 常见模型提供商的兼容性

### ✅ 兼容的提供商
- **Anthropic Claude**: 原生支持
- **OpenAI GPT-4**: 支持流式，需要转换格式
- **DeepSeek**: 支持，需要工具调用优化
- **Gemini**: 支持，需要格式转换

### ⚠️ 需要转换的提供商
- **本地 Ollama**: 需要自定义适配器
- **其他 OpenAI 兼容API**: 可能需要自定义 transformer

## 测试验证

要验证你的模型是否正确返回 token 统计：

1. 启动 Claude Code Router
2. 发送请求到你的模型
3. 检查路由器的日志文件：`~/.claude-code-router/claude-code-router.log`
4. 查找类似日志：
   ```
   [INFO] Using long context model due to token count: 65000, threshold: 60000
   ```

## Node.js 模拟服务器示例

```javascript
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.url === '/v1/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      // 解析请求
      const requestData = JSON.parse(body);

      // 设置 SSE 头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // 发送流式响应
      const usage = {
        input_tokens: 25, // 实际应该根据请求计算
        output_tokens: 0
      };

      // message_start
      res.write(`event: message_start\n`);
      res.write(`data: ${JSON.stringify({
        type: "message",
        id: "msg_test",
        role: "assistant",
        content: [],
        model: "test-model",
        usage: usage
      })}\n\n`);

      // 模拟内容发送
      const responses = ["Hello", " from", " the", " model!"];
      responses.forEach((text, index) => {
        res.write(`event: content_block_delta\n`);
        res.write(`data: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text }
        })}\n\n`);
      });

      // message_delta（包含最终的usage统计）
      const finalUsage = {
        input_tokens: 25,
        output_tokens: responses.join('').length
      };

      res.write(`event: message_delta\n`);
      res.write(`data: ${JSON.stringify({
        type: "message_delta",
        usage: finalUsage
      })}\n\n`);

      res.write(`event: message_stop\n`);
      res.write(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`);

      res.end();
    });
  }
});

server.listen(3000, () => {
  console.log('Mock server running on port 3000');
});
```

## 故障排除

### 问题：路由器没有感知到 token 数量
**可能原因：**
1. 响应不是流式格式
2. 缺少 `message_delta` 事件
3. `usage` 字段格式不正确
4. Content-Type 不是 `text/event-stream`

### 问题：usage 数值不准确
**解决方案：**
1. 确保 input_tokens 包含完整请求的 token 数
2. 确保 output_tokens 包含实际生成的 token 数
3. 使用与路由器相同的 token 计算方法（tiktoken）

### 问题：路由器切换到错误模型
**调试方法：**
1. 检查 `sessionUsageCache` 是否正确更新
2. 验证 `longContextThreshold` 配置
3. 查看路由器决策日志

## 相关代码位置

- **Token计算**: `src/utils/router.ts:16-68`
- **Usage缓存**: `src/utils/cache.ts`
- **流式处理**: `src/index.ts:328-360`
- **SSE解析**: `src/utils/SSEParser.transform.ts`