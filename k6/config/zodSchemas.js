import { z } from '../vendor/zod.bundle.js';

// 全局接口 Schemas，按 tag 请求标识进行结构校验
// 安全地兼容 OL 的 optional()，避免在某些 lite 实现上报错
const _arrayAnyOptional =
  typeof z.array(z.any()).optional === 'function' ? z.array(z.any()).optional() : z.array(z.any());
const _arrayAnyOptional2 =
  typeof z.array(z.any()).optional === 'function' ? z.array(z.any()).optional() : z.array(z.any());

export const Schemas = {
  // 后台登录的响应类型
  adminLogin: z
    .object({
      code: z.number(),
      data: z.object({ token: z.string() }).optional(),
      msg: z.string().optional(),
      msgCode: z.number().optional()
    })
    .passthrough(),
  // 查询仪表盘的响应类型
  queryDashboard: z
    .object({
      code: z.number(),
      data: _arrayAnyOptional2
    })
    .passthrough(),

  GetRptDataSummaryCommission: z
    .object({
      code: z.number(),
      data: z.any().optional(),
      token: z.string().optional()
    })
    .passthrough(),

  GetPlatStatisticsData: z
    .object({
      code: z.number(),
      data: z.any().optional()
    })
    .passthrough()
  // 未来扩展：继续添加其他接口 schema
};
