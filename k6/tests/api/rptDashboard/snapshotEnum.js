/**
 * 实时数据统计报表 —— snapshotType 枚举
 *
 * 维护 GetRecordSnapshotList 的 snapshotType 与 GetRealTimeSnapshotReport 各字段的映射。
 * field=null 表示实时报表里没有对应字段（老会员系列/人均/充提差），交叉对比时跳过。
 * kind 决定容差：count 精确相等；amount/rate 允许小容差(默认 0.01)。
 *
 * 已用真实响应逐项核对（2026-07-28）。
 */
export const SNAPSHOT_MAP = {
    0:  { name: '注册人数',           field: 'registerCount',           kind: 'count'  },
    1:  { name: '登录人数',           field: 'loginCount',              kind: 'count'  },
    2:  { name: '游戏人数',           field: 'gameCount',               kind: 'count'  },
    3:  { name: '当前在线',           field: 'onlineCount',             kind: 'count'  },
    4:  { name: '充值金额',           field: 'rechargeAmount',          kind: 'amount' },
    5:  { name: '提款金额',           field: 'withdrawAmount',          kind: 'amount' },
    6:  { name: '首存人数',           field: 'firstRechargeUserCount',  kind: 'count'  }, // 首存=首充口径
    7:  { name: '首充金额',           field: 'firstRechargeAmount',     kind: 'amount' },
    8:  { name: '首提人数',           field: 'firstWithdrawUserCount',  kind: 'count'  },
    9:  { name: '首提金额',           field: 'firstWithdrawAmount',     kind: 'amount' },
    10: { name: '老会员充值人数',     field: null },
    11: { name: '老会员充值金额',     field: null },
    12: { name: '老会员提款人数',     field: null },
    13: { name: '老会员提款金额',     field: null },
    14: { name: '新会员人均充值金额', field: null },
    15: { name: '老会员人均充值金额', field: null },
    16: { name: '盈亏金额',           field: 'winLoseAmount',           kind: 'amount' },
    17: { name: '三方成功率',         field: 'thirdPartySuccessRate',   kind: 'rate'   },
    18: { name: '注册充值转化率',     field: 'registerRechargeRate',    kind: 'rate'   },
    19: { name: '充值人数',           field: 'rechargeUserCount',       kind: 'count'  },
    20: { name: '二充人数',           field: 'secondRechargeUserCount', kind: 'count'  },
    21: { name: '提现人数',           field: 'withdrawUserCount',       kind: 'count'  },
    22: { name: '充提差',             field: null },
    23: { name: '活动参与人数',       field: 'activityUserCount',       kind: 'count'  },
    24: { name: '活动金额',           field: 'activityAmount',          kind: 'amount' },
};

/** 全部 snapshotType 列表（请求第一步接口用） */
export const ALL_SNAPSHOT_TYPES = Object.keys(SNAPSHOT_MAP).map(Number);
