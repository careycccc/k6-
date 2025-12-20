// 基础类型
export const baseObject = {
    random: { type: 'int' },
    language: { type: 'string' },
    signature: { type: 'string' },
    timestamp: { type: 'int' },
}


// 响应规则
export const responseRules = {
    expectedCode: 0,  // 预期的业务字段
    expectedMessage: 'Succeed',     // 预期的业务字段值
    customChecks:{
        data:(data)=>{
            // 判断有没有data字段，如果没有就直接通过
            if(!data){
                return true;
            }
            // 主要是检测这个data字段是不是一个对象并且还必须要有值
            return typeof data === 'object' && Object.keys(data).length > 0;
        }
    }
}