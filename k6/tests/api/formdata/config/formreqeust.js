// 存放一些公共函数

import { sendRequest, sendQueryRequest } from "../../common/request.js";

/**
 * @param {string} api
 * @param {object} payload  请求的数据
 * @param {string} tag   每个请求的标志位
 * @param {object} data 上下文的数据比如token
 * @returns {Object} 返回对象
*/
export function commonRequest(data, api, payload, tag) {
    const token = data.token
    let result = sendRequest(payload, api, tag, false, token)
    // console.log('')
    // console.log(`${api}请求的结果:${result}'`)
    // console.log(typeof result)
    // console.log('')
    if (typeof result != 'object') {
        result = JSON.parse(result)
    }
    if (result && result != null) {
        return result
    }
    return {}
}


/**
 * @param {string} api
 * @param {object} payload  请求的数据
 * @param {string} tag   每个请求的标志位
 * @param {object} data 上下文的数据比如token
 * @returns {Array} 返回数组
*/
export function commonRequest2(data, api, payload, tag) {
    const token = data.token
    let result = sendRequest(payload, api, tag, false, token)
    if (typeof result != 'object') {
        result = JSON.parse(result)
    }
    if (result && result.length > 0) {
        return result
    }
    return []
}


/**
 * @param {string} api
 * @param {object} payload  请求的数据
 * @param {string} tag   每个请求的标志位
 * @param {object} data 上下文的数据比如token
 * @returns {Array,object} 返回数组,对象
*/
export function commonRequest3(data, api, payload, tag) {
    const token = data.token
    let result = sendQueryRequest(payload, api, tag, false, token)
    if (typeof result != 'object') {
        result = JSON.parse(result)
    }
    if (result && result.list.length > 0 && result.summary) {
        return { list: result.list, summary: result.summary, totalCount: result.totalCount }
    }
    return { list: [], summary: {} }
}

/**
 * @param {string} api
 * @param {object} payload  请求的数据
 * @param {string} tag   每个请求的标志位
 * @param {object} data 上下文的数据比如token
 * @returns {Array} 返回数组
*/
export function commonRequest4(data, api, payload, tag) {
    const token = data.token
    let result = sendRequest(payload, api, tag, false, token)
    if (typeof result != 'object') {
        result = JSON.parse(result)
    }
    if (result && result.list.length > 0) {
        return result.list
    }
    return []
}


/**
 * 比较两个列表是否包含相同的元素，基于指定的两个属性（不考虑顺序）
 * @param {Array} list1 - 第一个列表
 * @param {Array} list2 - 第二个列表
 * @param {string} prop1 - 第一个要比较的属性名
 * @param {string} prop2 - 第二个要比较的属性名
 * @returns {boolean} 如果两个列表包含相同的元素（基于指定属性）则返回true，否则返回false
 */
export function compareListsByTwoProperties(list1, list2, prop1, prop2) {
    //console.log(`比较两个列表是否相等，基于指定的两个属性: list1=${list1}, list2=${list2}, prop1=${prop1}, prop2=${prop2}`);

    // 检查输入是否为数组或是否为undefined/null
    if (!list1 || !list2 || !Array.isArray(list1) || !Array.isArray(list2)) {
        console.error('两个参数都必须是有效的数组');
        return false;
    }

    // 检查属性名是否有效
    if (typeof prop1 !== 'string' || typeof prop2 !== 'string') {
        console.error('属性名必须是字符串');
        return false;
    }

    // 比较列表长度
    if (list1.length !== list2.length) {
        console.log(`列表长度不匹配: list1长度=${list1.length}, list2长度=${list2.length}`);
        return false;
    }

    // 为每个列表中的对象创建一个唯一的标识符，基于指定的两个属性
    const createKey = (obj) => {
        if (!obj || typeof obj !== 'object') {
            return '';
        }
        return `${obj[prop1]}_${obj[prop2]}`;
    };

    // 创建list1的键集合
    const list1Keys = new Set(list1.map(createKey));

    // 检查list2中的每个对象是否存在于list1中
    for (const obj2 of list2) {
        const key2 = createKey(obj2);
        if (!list1Keys.has(key2)) {
            console.log(`list2中的对象在list1中未找到: ${prop1}=${obj2[prop1]}, ${prop2}=${obj2[prop2]}`);
            return false;
        }
    }

    return true;
}






/**
 * 返回数组中指定属性值最大的4个对象
 * @param {Array<Object>} arr - 输入的对象数组
 * @param {string} propertyName - 要比较的属性名（如 'amount', 'a', 'b' 等）
 * @returns {Array<Object>} 指定属性值最大的4个对象（按属性值降序排列）
 * @throws {Error} 如果数组为空或包含无效对象
 */
export function getMaxFourElements(arr, propertyName) {
    // 检查数组是否为空
    if (!arr || arr.length === 0) {
        throw new Error('数组不能为空');
    }

    // 检查是否所有元素都是包含指定属性的对象
    const allValidObjects = arr.every(item =>
        typeof item === 'object' &&
        item !== null &&
        typeof item[propertyName] === 'number' &&
        !isNaN(item[propertyName])
    );
    if (!allValidObjects) {
        throw new Error(`数组中每个元素都必须是包含${propertyName}属性的对象`);
    }

    // 按指定属性值排序（降序），保留重复元素
    const sorted = arr.sort((a, b) => b[propertyName] - a[propertyName]);

    // 返回前4个元素（如果数组长度小于4，则返回所有元素）
    return sorted.slice(0, 4);
}



