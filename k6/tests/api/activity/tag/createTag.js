import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createTagTag = 'createTag';

// 手动标签配置列表
const manualTagConfigs = [
    {
        type: 1,
        name: "土豪玩家",
        remark: "这是土豪玩家"
    },
    {
        type: 4,
        name: "平民玩家",
        remark: "平民玩家"
    },
    {
        type: 3,
        name: "异常玩家",
        remark: "异常玩家"
    }
];

// 基础标签配置列表
const basicTagConfigs = [
    {
        tagName: "基础标签-重提差",
        conditionType: 1,
        conditionMin: 100,
        conditionMax: 1000
    },
    {
        tagName: "基础标签-vip",
        conditionType: 3,
        conditionMin: 3,
        conditionMax: 8
    },
    {
        tagName: "基础标签-充值总金额",
        conditionType: 4,
        conditionMin: 10000,
        conditionMax: 100000
    },
    {
        tagName: "基础标签-提现总金额",
        conditionType: 6,
        conditionMin: 1000,
        conditionMax: 100000
    },
    {
        tagName: "基础标签-流失天数",
        conditionType: 8,
        conditionMin: 3,
        conditionMax: 10
    },
    {
        tagName: "基础标签-注册天数",
        conditionType: 11,
        conditionMin: 2,
        conditionMax: 10
    }
];

// 组合标签配置列表
// 注意：basicTagNames 会在运行时转换为 basicTagIds
const compositeTagConfigs = [
    {
        tagName: "流失3天以上且vip等级在3以上且充值总金额在10000以上",
        basicTagNames: [
            "基础标签-流失天数",
            "基础标签-vip",
            "基础标签-充值总金额"
        ]
    },
    {
        tagName: "重提差在100-1000或注册天数已经有2天以上的或者提现超过1000的会员",
        basicTagNames: [
            "基础标签-重提差",
            "基础标签-注册天数",
            "基础标签-提现总金额"
        ]
    }
];

/**
 * 创建标签
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示标签创建成功
 * - success: false 表示跳过该标签，不进行创建
 */
export function createTagfunc(data) {
    logger.info(`[${createTagTag}] 开始创建标签`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createTagTag}] Token 不存在，无法创建标签`);
            return {
                success: false,
                tag: createTagTag,
                message: 'Token 不存在，跳过标签创建'
            };
        }

        // 步骤1：创建手动标签
        logger.info(`[${createTagTag}] ========== 步骤1：创建手动标签 ==========`);
        const createResult = createManualTags(data);
        if (!createResult.success) {
            return {
                success: false,
                tag: createTagTag,
                message: `创建手动标签失败: ${createResult.message}`
            };
        }
        logger.info(`[${createTagTag}] 手动标签创建完成`);

        // 等待1秒，确保标签创建完成
        sleep(1);

        // 步骤2：查询标签列表并保存ID
        logger.info(`[${createTagTag}] ========== 步骤2：查询标签列表 ==========`);
        const queryResult = queryTagList(data);
        if (!queryResult.success) {
            return {
                success: false,
                tag: createTagTag,
                message: `查询标签列表失败: ${queryResult.message}`
            };
        }
        logger.info(`[${createTagTag}] 查询到 ${queryResult.tagList.length} 个标签`);

        // 将标签列表保存到data中，供后续活动使用
        data.tagList = queryResult.tagList;
        data.tagIdMap = queryResult.tagIdMap;

        // 步骤3：创建基础标签
        logger.info(`[${createTagTag}] ========== 步骤3：创建基础标签 ==========`);
        const createBasicResult = createBasicTags(data);
        if (!createBasicResult.success) {
            return {
                success: false,
                tag: createTagTag,
                message: `创建基础标签失败: ${createBasicResult.message}`
            };
        }
        logger.info(`[${createTagTag}] 基础标签创建完成`);

        // 等待1秒，确保基础标签创建完成
        sleep(1);

        // 步骤4：查询基础标签列表并保存ID
        logger.info(`[${createTagTag}] ========== 步骤4：查询基础标签列表 ==========`);
        const queryBasicResult = queryBasicTagList(data);
        if (!queryBasicResult.success) {
            return {
                success: false,
                tag: createTagTag,
                message: `查询基础标签列表失败: ${queryBasicResult.message}`
            };
        }
        logger.info(`[${createTagTag}] 查询到 ${queryBasicResult.basicTagList.length} 个基础标签`);

        // 将基础标签列表保存到data中，供后续活动使用
        data.basicTagList = queryBasicResult.basicTagList;
        data.basicTagIdMap = queryBasicResult.basicTagIdMap;

        // 步骤5：创建组合标签
        logger.info(`[${createTagTag}] ========== 步骤5：创建组合标签 ==========`);
        const createCompositeResult = createCompositeTags(data);
        if (!createCompositeResult.success) {
            return {
                success: false,
                tag: createTagTag,
                message: `创建组合标签失败: ${createCompositeResult.message}`
            };
        }
        logger.info(`[${createTagTag}] 组合标签创建完成`);

        // 等待1秒，确保组合标签创建完成
        sleep(1);

        // 步骤6：查询组合标签列表并保存ID
        logger.info(`[${createTagTag}] ========== 步骤6：查询组合标签列表 ==========`);
        const queryCompositeResult = queryCompositeTagList(data);
        if (!queryCompositeResult.success) {
            return {
                success: false,
                tag: createTagTag,
                message: `查询组合标签列表失败: ${queryCompositeResult.message}`
            };
        }
        logger.info(`[${createTagTag}] 查询到 ${queryCompositeResult.compositeTagList.length} 个组合标签`);

        // 将组合标签列表保存到data中，供后续活动使用
        data.compositeTagList = queryCompositeResult.compositeTagList;
        data.compositeTagIdMap = queryCompositeResult.compositeTagIdMap;

        logger.info(`[${createTagTag}] 标签创建成功`);
        return {
            success: true,
            tag: createTagTag,
            message: '标签创建成功',
            // 手动标签
            tagList: queryResult.tagList,
            tagIdMap: queryResult.tagIdMap,
            // 基础标签
            basicTagList: queryBasicResult.basicTagList,
            basicTagIdMap: queryBasicResult.basicTagIdMap,
            // 组合标签
            compositeTagList: queryCompositeResult.compositeTagList,
            compositeTagIdMap: queryCompositeResult.compositeTagIdMap
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createTagTag}] 创建标签时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createTagTag,
            message: `创建标签失败: ${errorMsg}`
        };
    }
}

/**
 * 创建手动标签
 * @param {*} data
 * @returns {Object} 创建结果 { success, message }
 */
function createManualTags(data) {
    const token = data.token;
    const submitTagApi = '/api/Tags/SubmitTags';

    try {
        let successCount = 0;
        let failedTags = [];

        // 循环创建每个标签
        for (let i = 0; i < manualTagConfigs.length; i++) {
            const tagConfig = manualTagConfigs[i];

            logger.info(`[${createTagTag}] 创建标签 ${i + 1}/${manualTagConfigs.length}: ${tagConfig.name} (type: ${tagConfig.type})`);

            const payload = {
                type: tagConfig.type,
                name: tagConfig.name,
                remark: tagConfig.remark
            };

            const result = sendRequest(payload, submitTagApi, createTagTag, false, token);

            logger.info(`[${createTagTag}] 标签创建响应: ${JSON.stringify(result)}`);

            // 检查响应
            if (result && result.msgCode === 0) {
                successCount++;
                logger.info(`[${createTagTag}] 标签 "${tagConfig.name}" 创建成功`);
            } else if (result && (result.msgCode === 2103 || result.msgCode === 2021)) {
                // 标签名称已存在（msgCode: 2103 或 2021），视为警告并跳过
                successCount++;
                logger.warn(`[${createTagTag}] 标签 "${tagConfig.name}" 已存在，跳过创建: ${result?.msg || 'Tag name already exists'}`);
            } else {
                failedTags.push(tagConfig.name);
                logger.error(`[${createTagTag}] 标签 "${tagConfig.name}" 创建失败: ${result?.msg || '未知错误'}`);
            }

            // 等待0.5秒再创建下一个标签
            if (i < manualTagConfigs.length - 1) {
                sleep(0.5);
            }
        }

        if (successCount === manualTagConfigs.length) {
            logger.info(`[${createTagTag}] 所有标签创建成功 (${successCount}/${manualTagConfigs.length})`);
            return {
                success: true,
                message: `标签创建成功，共创建 ${successCount} 个标签`
            };
        } else if (successCount > 0) {
            logger.warn(`[${createTagTag}] 部分标签创建成功 (${successCount}/${manualTagConfigs.length})`);
            return {
                success: true,
                message: `部分标签创建成功 (${successCount}/${manualTagConfigs.length})，失败: ${failedTags.join(', ')}`
            };
        } else {
            logger.error(`[${createTagTag}] 所有标签创建失败`);
            return {
                success: false,
                message: '所有标签创建失败'
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createTagTag}] 创建手动标签时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建失败: ${errorMsg}`
        };
    }
}

/**
 * 查询标签列表
 * @param {*} data
 * @returns {Object} 查询结果 { success, message, tagList, tagIdMap }
 */
function queryTagList(data) {
    const token = data.token;
    const getTagListApi = '/api/Tags/GetPageList';

    try {
        logger.info(`[${createTagTag}] 查询标签列表`);

        const payload = {
            sortField: "id",
            orderBy: "Desc"
        };

        const result = sendQueryRequest(payload, getTagListApi, createTagTag, false, token);

        if (!result) {
            logger.error(`[${createTagTag}] 查询标签列表失败: 响应为空`);
            return {
                success: false,
                message: '查询标签列表失败: 响应为空',
                tagList: [],
                tagIdMap: {}
            };
        }

        //logger.info(`[${createTagTag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应
        let tagList;
        if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${createTagTag}] 查询标签列表失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询标签列表失败: ${result.msg || '未知错误'}`,
                    tagList: [],
                    tagIdMap: {}
                };
            }
            // 从 data.list 中获取标签列表
            tagList = result.data?.list || result.list || [];
        } else {
            tagList = result.list || [];
        }

        if (!tagList || !Array.isArray(tagList) || tagList.length === 0) {
            logger.error(`[${createTagTag}] 标签列表为空`);
            return {
                success: false,
                message: '标签列表为空',
                tagList: [],
                tagIdMap: {}
            };
        }

        logger.info(`[${createTagTag}] 查询到 ${tagList.length} 个标签`);

        // 创建标签名称到ID的映射
        const tagIdMap = {};
        tagList.forEach(tag => {
            if (tag.name && tag.id) {
                tagIdMap[tag.name] = tag.id;
                //logger.info(`[${createTagTag}] 标签映射: ${tag.name} -> ID: ${tag.id} (type: ${tag.type})`);
            }
        });

        return {
            success: true,
            message: `成功查询到 ${tagList.length} 个标签`,
            tagList: tagList,
            tagIdMap: tagIdMap
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createTagTag}] 查询标签列表时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`,
            tagList: [],
            tagIdMap: {}
        };
    }
}


/**
 * 创建基础标签
 * @param {*} data
 * @returns {Object} 创建结果 { success, message }
 */
function createBasicTags(data) {
    const token = data.token;
    const submitBasicTagApi = '/api/TagConfig/SubmitBasicTag';

    try {
        let successCount = 0;
        let failedTags = [];

        // 循环创建每个基础标签
        for (let i = 0; i < basicTagConfigs.length; i++) {
            const tagConfig = basicTagConfigs[i];

            logger.info(`[${createTagTag}] 创建基础标签 ${i + 1}/${basicTagConfigs.length}: ${tagConfig.tagName} (conditionType: ${tagConfig.conditionType})`);

            const payload = {
                tagName: tagConfig.tagName,
                conditionType: tagConfig.conditionType,
                conditionMin: tagConfig.conditionMin,
                conditionMax: tagConfig.conditionMax
            };

            const result = sendRequest(payload, submitBasicTagApi, createTagTag, false, token);

            logger.info(`[${createTagTag}] 基础标签创建响应: ${JSON.stringify(result)}`);

            // 检查响应
            if (result && result.msgCode === 0) {
                successCount++;
                logger.info(`[${createTagTag}] 基础标签 "${tagConfig.tagName}" 创建成功`);
            } else if (result && (result.msgCode === 2103 || result.msgCode === 2021)) {
                // 标签名称已存在（msgCode: 2103 或 2021），视为警告并跳过
                successCount++;
                logger.warn(`[${createTagTag}] 基础标签 "${tagConfig.tagName}" 已存在，跳过创建: ${result?.msg || 'Tag name already exists'}`);
            } else {
                failedTags.push(tagConfig.tagName);
                logger.error(`[${createTagTag}] 基础标签 "${tagConfig.tagName}" 创建失败: ${result?.msg || '未知错误'}`);
            }

            // 等待0.5秒再创建下一个标签
            if (i < basicTagConfigs.length - 1) {
                sleep(0.5);
            }
        }

        if (successCount === basicTagConfigs.length) {
            logger.info(`[${createTagTag}] 所有基础标签创建成功 (${successCount}/${basicTagConfigs.length})`);
            return {
                success: true,
                message: `基础标签创建成功，共创建 ${successCount} 个标签`
            };
        } else if (successCount > 0) {
            logger.warn(`[${createTagTag}] 部分基础标签创建成功 (${successCount}/${basicTagConfigs.length})`);
            return {
                success: true,
                message: `部分基础标签创建成功 (${successCount}/${basicTagConfigs.length})，失败: ${failedTags.join(', ')}`
            };
        } else {
            logger.error(`[${createTagTag}] 所有基础标签创建失败`);
            return {
                success: false,
                message: '所有基础标签创建失败'
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createTagTag}] 创建基础标签时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建失败: ${errorMsg}`
        };
    }
}

/**
 * 查询基础标签列表
 * @param {*} data
 * @returns {Object} 查询结果 { success, message, basicTagList, basicTagIdMap }
 */
function queryBasicTagList(data) {
    const token = data.token;
    const getBasicTagListApi = '/api/TagConfig/GetBasicTagPageList';

    try {
        logger.info(`[${createTagTag}] 查询基础标签列表`);

        const payload = {
            orderBy: "Desc"
        };

        const result = sendQueryRequest(payload, getBasicTagListApi, createTagTag, false, token);

        if (!result) {
            logger.error(`[${createTagTag}] 查询基础标签列表失败: 响应为空`);
            return {
                success: false,
                message: '查询基础标签列表失败: 响应为空',
                basicTagList: [],
                basicTagIdMap: {}
            };
        }

        //logger.info(`[${createTagTag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应
        let basicTagList;

        // 检查是否直接返回数组
        if (Array.isArray(result)) {
            basicTagList = result;
        } else if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${createTagTag}] 查询基础标签列表失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询基础标签列表失败: ${result.msg || '未知错误'}`,
                    basicTagList: [],
                    basicTagIdMap: {}
                };
            }
            // 从 data.list 中获取基础标签列表
            basicTagList = result.data?.list || result.list || [];
        } else if (result.list) {
            basicTagList = result.list;
        } else {
            basicTagList = [];
        }

        if (!basicTagList || !Array.isArray(basicTagList) || basicTagList.length === 0) {
            logger.error(`[${createTagTag}] 基础标签列表为空`);
            return {
                success: false,
                message: '基础标签列表为空',
                basicTagList: [],
                basicTagIdMap: {}
            };
        }

        logger.info(`[${createTagTag}] 查询到 ${basicTagList.length} 个基础标签`);

        // 创建基础标签名称到ID的映射
        const basicTagIdMap = {};
        basicTagList.forEach(tag => {
            if (tag.tagName && tag.id) {
                basicTagIdMap[tag.tagName] = tag.id;
                //logger.info(`[${createTagTag}] 基础标签映射: ${tag.tagName} -> ID: ${tag.id} (conditionType: ${tag.conditionType})`);
            }
        });

        return {
            success: true,
            message: `成功查询到 ${basicTagList.length} 个基础标签`,
            basicTagList: basicTagList,
            basicTagIdMap: basicTagIdMap
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createTagTag}] 查询基础标签列表时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`,
            basicTagList: [],
            basicTagIdMap: {}
        };
    }
}

/**
 * 创建组合标签
 * @param {*} data
 * @returns {Object} 创建结果 { success, message }
 */
function createCompositeTags(data) {
    const token = data.token;
    const submitCompositeTagApi = '/api/TagConfig/SubmitCompositeTag';
    const basicTagIdMap = data.basicTagIdMap;

    if (!basicTagIdMap || Object.keys(basicTagIdMap).length === 0) {
        logger.error(`[${createTagTag}] 基础标签ID映射为空，无法创建组合标签`);
        return {
            success: false,
            message: '基础标签ID映射为空，无法创建组合标签'
        };
    }

    try {
        let successCount = 0;
        let failedTags = [];

        // 循环创建每个组合标签
        for (let i = 0; i < compositeTagConfigs.length; i++) {
            const tagConfig = compositeTagConfigs[i];

            logger.info(`[${createTagTag}] 创建组合标签 ${i + 1}/${compositeTagConfigs.length}: ${tagConfig.tagName}`);

            // 将基础标签名称转换为ID
            const basicTagIds = [];
            let missingTags = [];

            for (const tagName of tagConfig.basicTagNames) {
                const tagId = basicTagIdMap[tagName];
                if (tagId) {
                    basicTagIds.push(tagId);
                    logger.info(`[${createTagTag}] 基础标签 "${tagName}" -> ID: ${tagId}`);
                } else {
                    missingTags.push(tagName);
                    logger.error(`[${createTagTag}] 基础标签 "${tagName}" 未找到对应的ID`);
                }
            }

            // 如果有缺失的基础标签，跳过该组合标签
            if (missingTags.length > 0) {
                failedTags.push(tagConfig.tagName);
                logger.error(`[${createTagTag}] 组合标签 "${tagConfig.tagName}" 缺少基础标签: ${missingTags.join(', ')}`);
                continue;
            }

            const payload = {
                tagName: tagConfig.tagName,
                packageIds: [],
                adGroupIds: [],
                conditionDetails: [
                    {
                        index: 0,
                        basicTagIds: basicTagIds
                    }
                ]
            };

            logger.info(`[${createTagTag}] 组合标签payload: ${JSON.stringify(payload)}`);

            const result = sendRequest(payload, submitCompositeTagApi, createTagTag, false, token);

            logger.info(`[${createTagTag}] 组合标签创建响应: ${JSON.stringify(result)}`);

            // 检查响应
            if (result && result.msgCode === 0) {
                successCount++;
                logger.info(`[${createTagTag}] 组合标签 "${tagConfig.tagName}" 创建成功`);
            } else if (result && (result.msgCode === 2103 || result.msgCode === 2021)) {
                // 标签名称已存在（msgCode: 2103 或 2021），视为警告并跳过
                successCount++;
                logger.warn(`[${createTagTag}] 组合标签 "${tagConfig.tagName}" 已存在，跳过创建: ${result?.msg || 'Tag name already exists'}`);
            } else {
                failedTags.push(tagConfig.tagName);
                logger.error(`[${createTagTag}] 组合标签 "${tagConfig.tagName}" 创建失败: ${result?.msg || '未知错误'}`);
            }

            // 等待0.5秒再创建下一个标签
            if (i < compositeTagConfigs.length - 1) {
                sleep(0.5);
            }
        }

        if (successCount === compositeTagConfigs.length) {
            logger.info(`[${createTagTag}] 所有组合标签创建成功 (${successCount}/${compositeTagConfigs.length})`);
            return {
                success: true,
                message: `组合标签创建成功，共创建 ${successCount} 个标签`
            };
        } else if (successCount > 0) {
            logger.warn(`[${createTagTag}] 部分组合标签创建成功 (${successCount}/${compositeTagConfigs.length})`);
            return {
                success: true,
                message: `部分组合标签创建成功 (${successCount}/${compositeTagConfigs.length})，失败: ${failedTags.join(', ')}`
            };
        } else {
            logger.error(`[${createTagTag}] 所有组合标签创建失败`);
            return {
                success: false,
                message: '所有组合标签创建失败'
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createTagTag}] 创建组合标签时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建失败: ${errorMsg}`
        };
    }
}

/**
 * 查询组合标签列表
 * @param {*} data
 * @returns {Object} 查询结果 { success, message, compositeTagList, compositeTagIdMap }
 */
function queryCompositeTagList(data) {
    const token = data.token;
    const getCompositeTagListApi = '/api/TagConfig/GetCompositeTagPageData';

    try {
        logger.info(`[${createTagTag}] 查询组合标签列表`);

        const payload = {};

        const result = sendQueryRequest(payload, getCompositeTagListApi, createTagTag, false, token);

        if (!result) {
            logger.error(`[${createTagTag}] 查询组合标签列表失败: 响应为空`);
            return {
                success: false,
                message: '查询组合标签列表失败: 响应为空',
                compositeTagList: [],
                compositeTagIdMap: {}
            };
        }

        //logger.info(`[${createTagTag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应
        let compositeTagList;

        // 检查是否直接返回数组
        if (Array.isArray(result)) {
            compositeTagList = result;
        } else if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${createTagTag}] 查询组合标签列表失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询组合标签列表失败: ${result.msg || '未知错误'}`,
                    compositeTagList: [],
                    compositeTagIdMap: {}
                };
            }
            // 从 data.list 中获取组合标签列表
            compositeTagList = result.data?.list || result.list || [];
        } else if (result.list) {
            compositeTagList = result.list;
        } else {
            compositeTagList = [];
        }

        if (!compositeTagList || !Array.isArray(compositeTagList) || compositeTagList.length === 0) {
            logger.error(`[${createTagTag}] 组合标签列表为空`);
            return {
                success: false,
                message: '组合标签列表为空',
                compositeTagList: [],
                compositeTagIdMap: {}
            };
        }

        logger.info(`[${createTagTag}] 查询到 ${compositeTagList.length} 个组合标签`);

        // 创建组合标签名称到ID的映射
        const compositeTagIdMap = {};
        compositeTagList.forEach(tag => {
            if (tag.tagName && tag.id) {
                compositeTagIdMap[tag.tagName] = tag.id;
                //logger.info(`[${createTagTag}] 组合标签映射: ${tag.tagName} -> ID: ${tag.id}`);
            }
        });

        return {
            success: true,
            message: `成功查询到 ${compositeTagList.length} 个组合标签`,
            compositeTagList: compositeTagList,
            compositeTagIdMap: compositeTagIdMap
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createTagTag}] 查询组合标签列表时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`,
            compositeTagList: [],
            compositeTagIdMap: {}
        };
    }
}
