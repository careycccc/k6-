/**
 * 钱包类型删除工单的通用骨架（银行卡/USDT/电子钱包共用这套流程，PIX/UPI 需要时可扩展）
 *
 * 流程：会员前台提交删除申请 → 后台锁定工单 → 后台调用该类型专属的"执行删除"接口
 * （如 DeleteUserBank/DeleteUserUsdt/DeleteElectronicWallet）→ 后台 Submit(state:4)
 * 把工单标记为已处理（这步只是状态收尾，真正的删除动作由专属接口完成）。
 *
 * 2026-11-03 实测确认的关键点：
 * - 提交申请这一步（/api/WorkOrder/Submit）几乎不校验 fieldValue 内容是否合法，传
 *   错误值依然会返回成功——"提交成功"不代表格式/数据是对的，必须走完整个流程并用
 *   GetWallet 实查才能确认删除是否真的生效。
 * - 银行卡(DeleteUserBank)：fieldValue 必须严格是 "{钱包记录id}|{实际值}" 格式，格式
 *   错误（比如只传实际值不带id）会被拒绝，报 "Param is Invalid"——因为银行卡允许
 *   同一用户同时绑定多张，必须靠这个信息精确定位删哪一条。
 * - USDT(DeleteUserUsdt)：同样按 "{id}|{值}" 格式传，已验证能成功删除；但测试时账号
 *   只有1条记录，不能100%确认这个格式对USDT是否"必需"（也可能和电子钱包一样不挑剔），
 *   保守起见统一按银行卡的规范传递。
 * - 电子钱包(DeleteElectronicWallet)：实测 fieldValue 传错误值（undefined）依然能
 *   成功删除，推测是因为电子钱包绑定数量上限为1（同一用户同时只会有0或1条记录），
 *   接口不需要靠 fieldValue 做区分。但本模块依然统一按规范格式传递，不依赖这个"容错"。
 */
import { sleep } from 'k6';
import { sendRequest, sendQueryRequest } from '../common/request.js';
import { signAndPost } from '../activity/workOrderSuite/lib/submitHelper.js';
import { getPendingOrders, lockOrder } from '../activity/workOrderSuite/lib/pendingHelper.js';

function fetchActiveForm(adminToken, workOrderTypeId, tag) {
    const res = sendQueryRequest(
        { workOrderTypeId, isLoginForm: 1, pageNo: 1, pageSize: 20 },
        '/api/TenantForm/GetPageList', tag, false, adminToken
    );
    if (!res || !res.list) return null;
    return res.list.find((f) => f.state === 1) || null;
}

function fetchFormFields(adminToken, formId, tag) {
    const detail = sendRequest({ id: formId }, '/api/TenantForm/Get', tag, false, adminToken);
    if (!detail || !detail.translationData) return [];
    const trans = detail.translationData.find((t) => t.language === 'en') || detail.translationData[0];
    return (trans.fields || []).map((f) => ({ type: f.type, id: f.id }));
}

/**
 * 会员前台提交删除申请（通用骨架）
 * @param {string} userToken
 * @param {string} adminToken     - 仅用于查表单配置，不用于提交本身
 * @param {number} workOrderTypeId
 * @param {string} fieldTypeCode  - 表单里目标字段的 typeCode，如 'BankAccountNumber'/'UsdtAddress'/'EWallet'
 * @param {string} fieldValue     - 已经拼好的 "{钱包记录id}|{实际值}" 格式
 * @param {string} tag            - 日志标签，便于区分是哪个类型的调用
 * @returns {boolean}
 */
export function submitDeleteWalletOrder(userToken, adminToken, workOrderTypeId, fieldTypeCode, fieldValue, tag) {
    const form = fetchActiveForm(adminToken, workOrderTypeId, tag);
    if (!form) {
        console.error(`[${tag}] 未找到 workOrderTypeId=${workOrderTypeId} 的已启用表单`);
        return false;
    }
    const fields = fetchFormFields(adminToken, form.id, tag);
    const formFields = fields.map((f) => ({
        typeCode: f.type,
        fieldId: f.id,
        fieldValue: f.type === fieldTypeCode ? fieldValue : ''
    }));

    const res = signAndPost(
        { formId: form.id, workOrderTypeId, formFields },
        '/api/WorkOrder/Submit', true, userToken, `${tag}_Submit`
    );

    if (res && res.code === 0) {
        console.log(`[${tag}] ✅ 删除工单提交成功: ${fieldValue}`);
        return true;
    }
    console.error(`[${tag}] ❌ 工单提交失败: ${JSON.stringify(res)}`);
    return false;
}

/**
 * 后台锁定该会员最新的待处理工单，并调用对应类型的专属接口真正执行删除，
 * 最后 Submit(state:4) 收尾（通用骨架）
 *
 * 注意：假设该 userId 当前只有一条待处理工单——如果账号有历史残留的其他类型/其他
 * 笔待处理工单，getPendingOrders 取到的 pending[0] 不一定是我们刚提交的这条。
 *
 * @param {string} adminToken
 * @param {number} userId
 * @param {string} deleteApi - 真正执行删除的接口路径，如 '/api/WorkOrder/DeleteUserBank'
 * @param {string} tag
 * @returns {boolean}
 */
export function approveAndExecuteDeleteWalletOrder(adminToken, userId, deleteApi, tag) {
    const pending = getPendingOrders(adminToken, userId);
    if (!pending || pending.length === 0) {
        console.error(`[${tag}] 没有待处理工单`);
        return false;
    }
    const order = pending[0];

    if (!lockOrder(order.id, adminToken)) {
        console.error(`[${tag}] 锁定工单失败`);
        return false;
    }
    sleep(2);

    const deleteRes = signAndPost({ workOrderId: order.id }, deleteApi, false, adminToken, `${tag}_Delete`);
    if (!deleteRes || deleteRes.code !== 0) {
        console.error(`[${tag}] ❌ ${deleteApi} 失败: ${JSON.stringify(deleteRes)}`);
        return false;
    }
    sleep(1);

    const approveRes = signAndPost(
        { workOrderId: order.id, state: 4, remark: 'auto_approve_by_k6' },
        '/api/WorkOrder/Submit', false, adminToken, `${tag}_Approve`
    );
    if (!approveRes || approveRes.code !== 0) {
        console.warn(`[${tag}] ⚠️ 工单状态流转失败（但删除动作已生效，不影响核心结果）: ${JSON.stringify(approveRes)}`);
    }

    console.log(`[${tag}] ✅ 删除流程完成: workOrderId=${order.id}`);
    return true;
}
