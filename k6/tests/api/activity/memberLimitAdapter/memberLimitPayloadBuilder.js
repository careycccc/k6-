/**
 * 默认的 Payload Patch 工具
 * 提供了一种基础的字段组装方式。
 * 调用方也可以根据具体的活动接口自定义 patch 逻辑。
 */
export function defaultPayloadPatcher(basePayload, config) {
    let payload = Object.assign({}, basePayload);
    
    // 初始化清空准入配置
    payload.userLimit = 0;
    payload.targetType = 0;
    payload.targetDetail = "";
    payload.limitGroups = "";

    switch(config.type) {
        case 'platform':
            payload.userLimit = 1;
            break;
        case 'group':
            payload.targetType = 2; // 假定 2 为分组
            payload.limitGroups = String(config.groupId);
            break;
        case 'vip':
            payload.targetType = 3; // 假定 3 为 VIP
            payload.limitGroups = String(config.vipLevel);
            break;
        case 'channel':
            payload.targetType = 4; // 假定 4 为渠道
            payload.limitGroups = String(config.packageId);
            break;
        case 'exclude':
            if (config.excludeGroup && config.excludeTag) {
                payload.targetDetail = JSON.stringify({
                    Group: String(config.excludeGroup),
                    TagComposite: String(config.excludeTag)
                });
            } else if (config.excludeGroup) {
                payload.limitGroups = String(config.excludeGroup);
            } else if (config.excludeTag) {
                payload.limitGroups = String(config.excludeTag);
            }
            break;
        case 'new_member':
            // 具体根据后台字段来，假设 targetType=1 为新用户
            payload.targetType = 1; 
            break;
    }
    
    return payload;
}
