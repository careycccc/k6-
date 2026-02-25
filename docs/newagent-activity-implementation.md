# 新版返佣活动 (createNewagent.js) 实现文档

## 概述

`createNewagent.js` 实现了新版返佣活动的完整配置流程，包含4个独立模块，每个模块负责不同的配置任务。

## 模块架构

```
createNewagent()
├── 模块1: 代理配置模块 (checkAndConfigureAgentSettings)
├── 模块2: 外链配置模块 (configureExternalLinks)
├── 模块3: 奖励模块配置 (configureInviteRewards)
└── 模块4: 团队返佣等级配置 (configureTeamRebateLevels)
```

## 模块详细说明

### 模块1：代理配置模块

**功能**: 配置代理系统的基础设置

**API**:
- 获取配置: `GET /api/AgentL3/GetConfig`
- 更新配置: `POST /api/AgentL3/UpdateConfig`

**配置项** (共9个):

| 配置键 | 说明 | 类型 | 规则 |
|--------|------|------|------|
| `agentL3AutoApproveRankReward` | 代理排行榜奖励自动审核通过开关 | 开关 | 先关后开/等1s后开 |
| `agentL3AutoSendCommission` | 自动领取佣金开关 | 开关 | 先关后开/等1s后开 |
| `agentL3InviteBetAmount` | 代理有效邀请投注金额 | 数字 | 当前值+2 |
| `agentL3InviteDayLimitCount` | 有效邀请奖励次数每日上限 | 数字 | 当前值+2 |
| `agentL3InviteRechargeAmount` | 代理有效邀请充值金额 | 数字 | 当前值+2 |
| `agentL3InviteRewardAmount` | 邀请人奖金 | 数字 | 当前值+2 |
| `agentL3InviteTotalLimitCount` | 有效邀请奖励次数总上限 | 数字 | 当前值+2 |
| `agentL3InviteWashCode` | 代理奖励打码量倍数 | 数字 | 当前值+2 |
| `agentL3InvitedRewardAmount` | 被邀请人金额 | 数字 | 当前值+2 |

**实现方式**: 使用统一配置处理器 `handleMultipleConfigs`

**代码示例**:
```javascript
const configRules = [
    { settingKey: 'agentL3AutoApproveRankReward', configType: ConfigType.SWITCH },
    { settingKey: 'agentL3InviteBetAmount', configType: ConfigType.NUMBER },
    // ... 其他配置
];

const result = handleMultipleConfigs({
    token, settings, configRules,
    updateApi: updateSettingApi,
    tag: createNewagentTag
});
```

---

### 模块2：外链配置模块

**功能**: 配置3个社交媒体外链（Telegram、WhatsApp、Instagram）

**API**:
- 查询外链: `GET /api/AgentL3/GetAgentExternalLinkList`
- 提交外链: `POST /api/AgentL3/SubmitAgentExternalLink`

**外链配置**:

| 序号 | 名称 | linkIndex | buttonText | jumpUrl | 图片 |
|------|------|-----------|------------|---------|------|
| 1 | Telegram | 1 | telegram | https://t.me/RA9OFFICIAL | outlink/1.png |
| 2 | WhatsApp | 2 | whatsapp | https://www.whatsapp.com/channel/... | outlink/2.png |
| 3 | Instagram | 3 | instagram | https://www.instagram.com/... | outlink/3.png |

**处理流程**:
1. 查询现有外链列表获取ID
2. 如果查询失败，跳过所有外链配置
3. 为每个外链上传图片（使用缓存机制）
4. 提交外链配置（linkType=2, state=1）

**图片上传**:
```javascript
// 模块顶层预加载图片
const uploadOutlinkImage1 = createImageUploader('../../uploadFile/img/outlink/1.png', createNewagentTag);
const uploadOutlinkImage2 = createImageUploader('../../uploadFile/img/outlink/2.png', createNewagentTag);
const uploadOutlinkImage3 = createImageUploader('../../uploadFile/img/outlink/3.png', createNewagentTag);

// 使用时
const imageResult = handleImageUpload(data, 'outlinkImage1Path', uploadOutlinkImage1, createNewagentTag);
```

**Payload 结构**:
```javascript
{
    id: 110001,              // 从查询结果获取
    linkType: 2,             // 固定值
    linkIndex: 1,            // 1, 2, 3
    imgUrl: "path/to/img",   // 上传后的图片路径
    buttonText: "telegram",  // 按钮文本
    jumpUrl: "https://...",  // 跳转链接
    state: 1                 // 启用状态
}
```

---

### 模块3：奖励模块配置

**功能**: 配置邀请奖励的递增规则

**API**:
- 查询奖励: `GET /api/AgentL3/GetListInviteTaskConfig`
- 更新奖励: `POST /api/AgentL3/UpdateInviteTaskConfig`

**配置规则**:
- `inviteUserCount`: 从1开始依次递增 (1, 2, 3, 4, 5...)
- `rewardAmount`: 从40开始每次+20 (40, 60, 80, 100, 120...)

**示例数据**:

| 序号 | inviteUserCount | rewardAmount |
|------|-----------------|--------------|
| 1 | 1 | 40 |
| 2 | 2 | 60 |
| 3 | 3 | 80 |
| 4 | 4 | 100 |
| 5 | 5 | 120 |

**处理流程**:
1. 查询现有奖励配置列表
2. 根据列表长度动态计算每个配置的值
3. 循环更新每个奖励配置

**代码逻辑**:
```javascript
for (let i = 0; i < rewardsList.length; i++) {
    const inviteUserCount = i + 1;           // 从1开始递增
    const rewardAmount = 40 + (i * 20);      // 从40开始，每次+20
    
    updateInviteReward(data, {
        id: rewardsList[i].id,
        inviteUserCount,
        rewardAmount
    });
}
```

---

### 模块4：团队返佣等级配置

**功能**: 配置4个团队等级的返佣比例

**API**:
- 查询等级: `GET /api/AgentL3/GetListRebateLevelRate`
- 更新等级: `POST /api/AgentL3/UpdateRebateLevelRate`

**等级配置**:

#### 等级0 (初级)
```javascript
{
    teamLevel: 0,
    teamPeoples: 0,
    teamBetAmount: 10000,
    teamRechargeRewardRate: 0.5,
    teamBetRewardRate: {
        electronic: { teamBetRewardRate_L1: 0.2, teamBetRewardRate_L2: 0.1, teamBetRewardRate_L3: 0.05 },
        video: { teamBetRewardRate_L1: 0.2, teamBetRewardRate_L2: 0.1, teamBetRewardRate_L3: 0.05 },
        sports: { teamBetRewardRate_L1: 0.2, teamBetRewardRate_L2: 0.1, teamBetRewardRate_L3: 0.05 },
        lottery: { teamBetRewardRate_L1: 0.2, teamBetRewardRate_L2: 0.1, teamBetRewardRate_L3: 0.05 },
        chessCard: { teamBetRewardRate_L1: 0.2, teamBetRewardRate_L2: 0.1, teamBetRewardRate_L3: 0.05 }
    }
}
```

#### 等级1 (中级)
```javascript
{
    teamLevel: 1,
    teamPeoples: 5,
    teamBetAmount: 50000,
    teamRechargeRewardRate: 1,
    teamBetRewardRate: {
        electronic: { teamBetRewardRate_L1: 0.3, teamBetRewardRate_L2: 0.15, teamBetRewardRate_L3: 0.07 },
        // ... 其他游戏类型相同
    }
}
```

#### 等级2 (高级)
```javascript
{
    teamLevel: 2,
    teamPeoples: 20,
    teamBetAmount: 100000,
    teamRechargeRewardRate: 1.5,
    teamBetRewardRate: {
        electronic: { teamBetRewardRate_L1: 0.4, teamBetRewardRate_L2: 0.2, teamBetRewardRate_L3: 0.1 },
        // ... 其他游戏类型相同
    }
}
```

#### 等级3 (顶级)
```javascript
{
    teamLevel: 3,
    teamPeoples: 30,
    teamBetAmount: 200000,
    teamRechargeRewardRate: 1,
    teamBetRewardRate: {
        electronic: { teamBetRewardRate_L1: 0.5, teamBetRewardRate_L2: 0.25, teamBetRewardRate_L3: 0.12 },
        // ... 其他游戏类型相同
    }
}
```

**游戏类型**:
- `electronic`: 电子游戏
- `video`: 视频游戏
- `sports`: 体育游戏
- `lottery`: 彩票游戏
- `chessCard`: 棋牌游戏

**返佣层级**:
- `teamBetRewardRate_L1`: 一级返佣比例
- `teamBetRewardRate_L2`: 二级返佣比例
- `teamBetRewardRate_L3`: 三级返佣比例

**处理流程**:
1. 查询现有团队等级配置列表
2. 根据查询结果的ID和预定义的配置模板进行匹配
3. 循环更新每个等级配置

---

## 执行流程

```
开始
  ↓
检查Token
  ↓
模块1: 代理配置 (9个配置项)
  ├─ 使用统一配置处理器
  └─ 开关类: 先关后开/等1s后开
      数字类: 当前值+2
  ↓
模块2: 外链配置 (3个外链)
  ├─ 查询外链列表获取ID
  ├─ 上传图片 (使用缓存)
  └─ 提交外链配置
  ↓
模块3: 奖励配置 (动态数量)
  ├─ 查询奖励列表
  └─ 循环更新 (inviteUserCount递增, rewardAmount+20)
  ↓
模块4: 团队等级配置 (4个等级)
  ├─ 查询等级列表获取ID
  └─ 循环更新 (使用预定义配置模板)
  ↓
完成
```

## 错误处理

每个模块都有独立的错误处理机制：

1. **响应验证**: 检查API响应是否有效
2. **数据解析**: 支持多种响应格式
3. **部分成功**: 支持部分配置成功的情况
4. **详细日志**: 记录每个步骤的执行情况
5. **失败列表**: 返回失败的配置项列表

## 使用示例

```javascript
import { createNewagent } from './createNewagent.js';

// 准备数据
const data = {
    token: 'your-auth-token',
    // 图片缓存（可选）
    outlinkImage1Path: 'cached/path/1.png',
    outlinkImage2Path: 'cached/path/2.png',
    outlinkImage3Path: 'cached/path/3.png'
};

// 执行配置
const result = createNewagent(data);

if (result.success) {
    console.log('✓ 新版返佣活动创建成功');
} else {
    console.log('✗ 失败:', result.message);
}
```

## 返回值格式

```javascript
{
    success: true/false,
    tag: 'createNewagent',
    message: '描述信息'
}
```

## 配置规则总结

| 模块 | 配置数量 | 处理方式 | 特殊规则 |
|------|----------|----------|----------|
| 模块1 | 9个 | 统一配置处理器 | 开关类先关后开，数字类+2 |
| 模块2 | 3个 | 查询ID+上传图片+提交 | 需要图片上传 |
| 模块3 | 动态 | 循环更新 | inviteUserCount递增，rewardAmount+20 |
| 模块4 | 4个 | 查询ID+模板匹配 | 使用预定义配置模板 |

## 依赖项

- `k6/sleep`: 等待时间控制
- `logger`: 日志记录
- `sendRequest`: 发送POST请求
- `sendQueryRequest`: 发送查询请求
- `createImageUploader`: 创建图片上传器
- `handleImageUpload`: 处理图片上传
- `handleMultipleConfigs`: 统一配置处理器
- `ConfigType`: 配置类型枚举

## 注意事项

1. **模块依赖**: 各模块独立执行，任一模块失败会中断整个流程
2. **图片缓存**: 外链图片支持缓存，避免重复上传
3. **等待时间**: 每个配置操作后有适当的等待时间
4. **ID获取**: 模块2、3、4都需要先查询获取ID
5. **动态配置**: 模块3和4根据查询结果动态处理

## 测试建议

1. 测试每个模块的独立功能
2. 测试部分配置失败的情况
3. 测试图片上传失败的处理
4. 测试查询列表为空的情况
5. 测试网络异常的错误处理

## 维护建议

1. 如需修改配置规则，更新对应模块的配置数组
2. 如需添加新的外链，在模块2中添加配置
3. 如需修改奖励规则，调整模块3的计算公式
4. 如需修改团队等级，更新模块4的配置模板
