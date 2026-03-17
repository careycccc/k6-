# 多租户邀请测试指南

## 概述

`runInviteByTenant.test.js` 支持在不同租户下执行多层级邀请测试，适用于多租户系统的邀请功能验证。

## 快速开始

### 方式1：使用环境变量（推荐）

```bash
# 指定租户3002，使用自定义邀请码和层级
k6 run -e TENANT_ID=3002 -e ROOT_INVITE_CODE=QSQKH5N -e LEVELS=6,7,5,5,7,6,3 k6/tests/api/invite/runInviteByTenant.test.js

# 只指定租户，使用配置文件中的默认值
k6 run -e TENANT_ID=3002 k6/tests/api/invite/runInviteByTenant.test.js

# 不指定租户，使用默认租户3004
k6 run k6/tests/api/invite/runInviteByTenant.test.js
```

### 方式2：配置文件（适合固定配置）

1. 编辑 `tenantConfig.js` 文件
2. 在 `TENANT_CONFIGS` 中添加或修改租户配置
3. 运行测试

```javascript
export const TENANT_CONFIGS = {
    '3002': {
        tenantId: '3002',
        name: '租户3002',
        rootInviteCode: 'YOUR_INVITE_CODE',  // 配置实际邀请码
        defaultLevels: [2, 2, 3],             // 配置层级
        description: '租户3002的邀请测试',
        enabled: true
    },
};
```

## 环境变量说明

| 变量名 | 说明 | 示例 | 必填 |
|--------|------|------|------|
| `TENANT_ID` | 租户ID | `3002` | 否（默认3004） |
| `ROOT_INVITE_CODE` | 总代邀请码 | `ABC123` | 是* |
| `LEVELS` | 层级配置，逗号分隔 | `2,2,3` | 否（使用配置文件默认值） |

*如果在 `tenantConfig.js` 中已配置，则不必填

## 层级配置说明

`LEVELS` 参数格式：`第1层人数,第2层人数,第3层人数,...`

示例：
- `2,2` - 第1层2人，第2层2人（共4人）
- `3,5,10` - 第1层3人，第2层5人，第3层10人（共18人）
- `1,1,1,1` - 4层，每层1人（共4人）

## 执行流程

脚本会自动执行以下步骤：

1. **管理员登录** - 获取管理员token
2. **多层级注册** - 按层级配置注册用户
   - 第1层：绑定到总代邀请码
   - 后续层级：绑定到上一层的用户
3. **获取用户信息** - 调用前台接口获取 userId 和 inviteCode
4. **人工充值** - 为所有用户充值（5000-15000随机金额）
5. **投注** - 所有用户执行投注
6. **统计结果** - 输出成功/失败统计

## 租户配置管理

### 添加新租户

编辑 `tenantConfig.js`：

```javascript
export const TENANT_CONFIGS = {
    // 现有配置...
    
    '3005': {
        tenantId: '3005',
        name: '租户3005',
        rootInviteCode: 'XYZ789',
        defaultLevels: [3, 3],
        description: '租户3005测试环境',
        enabled: true
    },
};
```

### 禁用租户

将 `enabled` 设置为 `false`：

```javascript
'3002': {
    // ...其他配置
    enabled: false  // 禁用此租户
}
```

## AI识别方案

### 配置文件结构

`tenantConfig.js` 提供了标准化的租户配置结构，AI可以：

1. **读取配置** - 通过 `getTenantConfig(tenantId)` 获取租户配置
2. **验证配置** - 通过 `validateTenantConfig(tenantId)` 验证配置完整性
3. **列出租户** - 通过 `getEnabledTenants()` 获取所有启用的租户
4. **打印信息** - 通过 `printTenantConfig(tenantId)` 显示配置详情

### 示例：AI自动识别和执行

```javascript
import { getEnabledTenants, getTenantConfig } from './tenantConfig.js';

// 获取所有启用的租户
const tenants = getEnabledTenants();
console.log(`可用租户: ${tenants.join(', ')}`);

// 获取特定租户配置
const config = getTenantConfig('3002');
if (config) {
    console.log(`租户3002配置: ${JSON.stringify(config)}`);
}
```

## 输出示例

```
[Setup] 开始管理员登录...
[Setup] ✅ 管理员登录成功

========== 测试配置 ==========
租户ID: 3002
租户名称: 租户3002
总代邀请码: ABC123
层级配置: 2 -> 2 -> 3 (共3层)
总用户数: 7
===================================

========== 🚀 开始多租户多层级邀请测试 ==========

📋 租户: 3002 - 租户3002
📋 总代邀请码: ABC123
📋 层级: 2 -> 2 -> 3

🚀 === 开始第1层绑定到总代 [ABC123] (2人) ===
✅ [1/2] 913149702599 -> ABC123 (邀请码: JQ9J4NN)
✅ [2/2] 913143062104 -> ABC123 (邀请码: PHMJT9N)

🚀 === 开始第2层绑定 (2人) ===
...

========== 处理结果统计 ==========
总用户数: 7
充值成功: 7
投注成功: 7
充值失败: 0
投注失败: 0
===================================

✅ 租户 3002 多层级邀请测试成功完成！
```

## 注意事项

1. **租户隔离** - 每个租户使用独立的邀请码和用户数据
2. **配置优先级** - 环境变量 > 配置文件 > 默认值
3. **错误处理** - 任何步骤失败都会停止整个流程
4. **数据清理** - 测试结束后自动清理内存中的用户数据

## 故障排查

### 问题：租户配置未找到

```
错误: 租户 3002 未配置 rootInviteCode
```

**解决方案**：
- 在 `tenantConfig.js` 中添加租户配置
- 或通过环境变量 `-e ROOT_INVITE_CODE=XXX` 指定

### 问题：邀请码无效

```
错误: 注册失败，停止邀请流程
```

**解决方案**：
- 检查邀请码是否正确
- 确认邀请码在目标租户下有效
- 验证邀请码未过期

## 相关文件

- `runInviteByTenant.test.js` - 多租户测试脚本
- `tenantConfig.js` - 租户配置文件
- `inviteService.js` - 邀请服务核心逻辑
- `QUICK-RUN.md` - 单租户快速运行指南
