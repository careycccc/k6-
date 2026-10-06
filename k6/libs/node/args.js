/**
 * Node runner 公共工具（CommonJS，给 *Runner.js 这类 node 脚本用，不能在 k6 里 import）
 */

/**
 * 解析命令行 --key value / --flag（无值记为 'true'）
 * @param {string[]} argv  一般传 process.argv
 * @returns {Object<string,string>}
 */
function parseArgs(argv) {
    const a = {};
    for (let i = 2; i < argv.length; i++) {
        const k = argv[i];
        if (k && k.startsWith('--')) {
            const key = k.slice(2);
            const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
            a[key] = val;
        }
    }
    return a;
}

module.exports = { parseArgs };
