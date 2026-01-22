

/**
 * 执行数据对比分析函数
 * 该函数接收一个结果数组，筛选出成功且包含数据的报表，然后对这些报表进行两两对比分析
 * @param {Array} results - 包含多个报表结果的数组，每个报表结果应包含success和data属性
 */
export function performDataComparison(results) {
    // 筛选出成功且包含数据的报表
    const successReports = results.filter((r) => r.success && r.data);
    console.log('一个表的数据', successReports[0].data);
}