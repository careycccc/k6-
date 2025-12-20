import crypto from 'k6/crypto';

export const signatureUtil = {
    /**
     * 过滤对象中的字段（排除 signature、timestamp、track）
     * @param {Object} obj - 原始对象
     * @returns {Object} 过滤后的对象
     */
    filterObject(obj) {
        const filtered = {};
        const excludeFields = ['signature', 'timestamp', 'track'];
        
        for (const key in obj) {
            if (!excludeFields.includes(key)) {
                const value = obj[key];
                // 排除 null、undefined 和空字符串
                if (value !== null && value !== undefined && value !== '') {
                    filtered[key] = value;
                }
            }
        }
        
        return filtered;
    },
    
    /**
     * 按键的字母顺序排序对象
     * @param {Object} obj - 原始对象
     * @returns {Object} 排序后的对象
     */
    sortObjectKeys(obj) {
        const sorted = {};
        Object.keys(obj)
            .sort()
            .forEach(key => {
                sorted[key] = obj[key];
            });
        return sorted;
    },
    
    /**
     * 生成签名字符串（按键排序）
     * @param {Object} obj - 原始数据
     * @param {Object} options - 选项
     * @returns {string} 签名字符串
     */
    createSignatureString(obj, options = {}) {
        const filtered = this.filterObject(obj);
        const sorted = this.sortObjectKeys(filtered);
        return JSON.stringify(sorted);
    },
    
    /**
     * 计算 MD5 哈希
     * @param {string} str - 输入字符串
     * @param {boolean} uppercase - 是否大写
     * @returns {string} MD5 哈希值
     */
    md5Info(str, uppercase = true) {
        const hash = crypto.md5(str, 'hex');
        return uppercase ? hash.toUpperCase() : hash;
    },
    
    /**
     * 获取签名（与 Go 版本一致）
     * @param {Object} obj - 原始数据
     * @param {string} verifyPwd - 验证密码
     * @returns {string} 签名
     */
    getSignature(obj, verifyPwd) {
        const filtered = this.filterObject(obj);
        const sorted = this.sortObjectKeys(filtered);
        const jsonString = JSON.stringify(sorted);
        const fullString = jsonString + verifyPwd;
        console.log('[调试] 最终参与签名的字符串是：', jsonString);
        return this.md5Info(fullString, true);
    },
    
    /**
     * 为请求添加签名
     * @param {Object} data - 原始数据
     * @param {Object} options - 选项
     * @returns {Object} 添加签名后的数据
     */
    signRequest(data, options = {}) {
        const { verifyPwd = '', includeTimestamp = true } = options;
        
        // 复制数据
        const result = { ...data };
        
        // 添加时间戳
        if (includeTimestamp) {
            result.timestamp = Math.floor(Date.now() / 1000);
        }
        
        // 计算并添加签名
        result.signature = this.getSignature(result, verifyPwd);
        
        return result;
    },
    
    /**
     * 验证签名
     * @param {Object} data - 包含签名的数据
     * @param {string} verifyPwd - 验证密码
     * @returns {boolean} 是否验证通过
     */
    verifySignature(data, verifyPwd) {
        // 保存原始签名
        const originalSignature = data.signature;
        
        // 移除签名字段
        const dataWithoutSignature = { ...data };
        delete dataWithoutSignature.signature;
        
        // 重新计算签名
        const calculatedSignature = this.getSignature(dataWithoutSignature, verifyPwd);
        
        // 比较签名
        return originalSignature === calculatedSignature;
    }
};
