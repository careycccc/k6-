/**
 * 按照指定属性分组并累加另一个属性的值
 * @param {Array} array - 要处理的数组
 * @param {string} groupByProp - 用于分组的属性名
 * @param {string} sumProp - 要累加的属性名
 * @returns {Object} 返回一个对象，result键为分组的属性值，值为累加后的值,count:这个对象的数量,sum 单个会员的值的总和
 */
export function groupByAndSum(array, groupByProp, sumProp) {
    // 检查参数是否有效
    if (!Array.isArray(array)) {
        console.error('第一个参数必须是数组');
        return {};
    }

    if (typeof groupByProp !== 'string' || typeof sumProp !== 'string') {
        console.error('分组属性和累加属性必须是字符串');
        return {};
    }
    const result = {};

    // 遍历数组，按照指定属性分组并累加
    for (const item of array) {
        // 检查分组属性是否存在
        if (!item.hasOwnProperty(groupByProp)) {
            console.warn(`数组中的对象缺少属性: ${groupByProp}`);
            continue;
        }

        // 检查累加属性是否存在
        if (!item.hasOwnProperty(sumProp)) {
            console.warn(`数组中的对象缺少属性: ${sumProp}`);
            continue;
        }

        const groupKey = item[groupByProp];
        const sumValue = Number(item[sumProp]) || 0;

        // 如果分组键不存在，初始化为0
        if (!result || !result[groupKey]) {
            result[groupKey] = 0;
        }

        // 累加值
        result[groupKey] += sumValue;
    }
    let sum = 0;
    for (const value of Object.values(result)) {
        sum += Number(value) || 0;
    }
    return {
        result,  // 单个会员的单个数据
        count: Object.keys(result).length,  // 单个会员的出现的次数
        sum: sum,  // 单个会员的值的总和
    };
}
