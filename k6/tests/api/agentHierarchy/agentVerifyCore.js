/**
 * 代理层级 / 转线 验证的【纯逻辑】—— 不依赖 k6，可被 k6 测试与 Node 离线校验共用。
 */

/** 由列表构建 id→节点、parentId→[子节点] 两个映射 */
export function buildMaps(list) {
    const nodeById = {};
    const childrenByParent = {};
    for (const m of list) {
        nodeById[m.userId] = m;
        (childrenByParent[m.parentId] = childrenByParent[m.parentId] || []).push(m);
    }
    return { nodeById, childrenByParent };
}

/** 递归统计某节点的全部后代数量（基于 parent→children 映射） */
export function countDescendants(childrenByParent, uid) {
    const kids = childrenByParent[uid] || [];
    let c = kids.length;
    for (const k of kids) c += countDescendants(childrenByParent, k.userId);
    return c;
}

/**
 * Step1：以 rootId 为根，逐层逐会员验证子树。
 *   1) 直属下级实际数 == firstChildCount（少了/多了都报）
 *   2) 每个直属下级 hierarchy == 父.hierarchy + 1（层级错误）
 *   3) 每个节点的全部后代递归数 == childCount
 * @returns {{errors: string[], teamSet: Set<number>, rootNode: object|null, checked: number}}
 */
export function verifyHierarchy(list, rootId) {
    const { nodeById, childrenByParent } = buildMaps(list);
    const errors = [];
    const teamSet = new Set();

    const rootNode = nodeById[rootId];
    if (!rootNode) {
        errors.push(`根节点 ${rootId} 不在接口返回的列表里（无法验证，请确认 userId / 租户是否正确）`);
        return { errors, teamSet, rootNode: null, checked: 0 };
    }

    // 总代(generalAgent)校验：一个团队只有一个总代。
    //   - 提供的 userId 若 parentId=0 → 它本身就是总代：其 generalAgentId 应指向自身、层级应为 0
    //   - 提供的是子代理 → 以它的 generalAgentId 作为团队总代
    // 随后要求子树里每个成员的 generalAgentId 都等于这个总代，否则该成员疑似不属于本团队（转线未更新总代）。
    const isRootGeneralAgent = rootNode.parentId === 0;
    const expectedGA = isRootGeneralAgent ? rootNode.userId : rootNode.generalAgentId;
    if (isRootGeneralAgent) {
        if (rootNode.generalAgentId !== rootNode.userId) {
            errors.push(`总代 ${rootNode.userId} 的 generalAgentId=${rootNode.generalAgentId}，应为自身 ${rootNode.userId}`);
        }
        if (rootNode.hierarchy !== 0) {
            errors.push(`总代 ${rootNode.userId} 层级应为 0，实际=${rootNode.hierarchy}`);
        }
    }

    let checked = 0;
    const queue = [rootNode];
    teamSet.add(rootNode.userId);

    while (queue.length) {
        const node = queue.shift();
        checked++;
        const kids = childrenByParent[node.userId] || [];

        // 0) 总代归属一致：本团队所有成员 generalAgentId 必须相同
        if (node.generalAgentId !== expectedGA) {
            errors.push(
                `id ${node.userId}(层级${node.hierarchy}) 总代不一致：generalAgentId=${node.generalAgentId}，应为 ${expectedGA}` +
                `（该会员疑似不属于本团队，或转线后总代/层级未更新）`
            );
        }

        // 1) 直属下级人数
        if (kids.length !== node.firstChildCount) {
            const diff = kids.length - node.firstChildCount;
            errors.push(
                `id ${node.userId}(层级${node.hierarchy}) 直属下级人数不对：接口 firstChildCount=${node.firstChildCount}，` +
                `实际找到=${kids.length}（${diff > 0 ? '多了 ' + diff : '少了 ' + (-diff)}）`
            );
        }

        // 2) 直属下级层级 == 父+1，且 parentId 指回父
        for (const k of kids) {
            if (k.hierarchy !== node.hierarchy + 1) {
                errors.push(
                    `id ${k.userId} 层级错误：其上级 ${node.userId} 层级=${node.hierarchy}，应为 ${node.hierarchy + 1}，实际=${k.hierarchy}`
                );
            }
            if (k.parentId !== node.userId) {
                errors.push(`id ${k.userId} 上级不一致：parentId=${k.parentId}，应为 ${node.userId}`);
            }
            if (!teamSet.has(k.userId)) { teamSet.add(k.userId); queue.push(k); }
        }

        // 3) 全部下级递归数 == childCount
        const desc = countDescendants(childrenByParent, node.userId);
        if (desc !== node.childCount) {
            errors.push(`id ${node.userId} 全部下级数不对：接口 childCount=${node.childCount}，递归实际=${desc}`);
        }
    }

    return { errors, teamSet, rootNode, checked, expectedGA };
}

/**
 * Step2：验证当天"转入本团队"的会员。
 *   - 每个 userId 取最近一次绑定记录(newParentId!=0, transferBeginTime 最大)
 *   - 只关心新上级在本团队(teamSet)内的记录（= 转入本团队）
 *   - userId 必须在团队里；新上级 hierarchy == newHierarchy-1；本人团队内 hierarchy == newHierarchy
 * @param {Array} transferList 当天转线记录
 * @param {Set<number>} teamSet Step1 子树成员集合
 * @param {object} nodeById id→节点
 * @returns {{errors: string[], infos: string[], intoTeamCount: number}}
 */
export function verifyTransfers(transferList, teamSet, nodeById) {
    const errors = [];
    const infos = [];
    const transferredIn = []; // 转入本团队的会员明细

    // 每个 userId 取最近一次"绑定"（newParentId!=0）
    const latestBind = {};
    for (const r of transferList) {
        if (!r || r.newParentId === 0 || r.newParentId == null) continue; // 解绑中间态跳过
        const cur = latestBind[r.userId];
        if (!cur || r.transferBeginTime > cur.transferBeginTime) latestBind[r.userId] = r;
    }

    for (const key of Object.keys(latestBind)) {
        const r = latestBind[key];
        const uid = r.userId;

        // 新上级不在本团队 → 不是"转入本团队"，跳过
        if (!teamSet.has(r.newParentId)) continue;

        const np = nodeById[r.newParentId];
        const nm = teamSet.has(uid) ? nodeById[uid] : null;
        const detail = {
            userId: uid,
            newParentId: r.newParentId,
            newHierarchy: r.newHierarchy,
            oldParentId: r.oldParentId,
            oldHierarchy: r.oldHierarchy,
            teamUserCount: r.teamUserCount,
            transferBeginTime: r.transferBeginTime,
            inTeam: !!nm,
            parentHierarchy: np ? np.hierarchy : null,
            actualHierarchy: nm ? nm.hierarchy : null,
            actualParentId: nm ? nm.parentId : null,
            ok: true,
            problems: [],
        };

        // userId 必须在团队里
        if (!nm) {
            detail.ok = false;
            detail.problems.push('团队子树里找不到该会员');
            errors.push(`转线：会员 ${uid} 最近被转入本团队(新上级 ${r.newParentId})，但团队子树里找不到该会员`);
        } else {
            // 新上级层级 == newHierarchy - 1
            if (np.hierarchy !== r.newHierarchy - 1) {
                detail.ok = false;
                detail.problems.push(`新上级层级=${np.hierarchy}≠newHierarchy-1=${r.newHierarchy - 1}`);
                errors.push(`转线：会员 ${uid} 的新上级 ${r.newParentId} 层级=${np.hierarchy}，应为 newHierarchy-1=${r.newHierarchy - 1}`);
            }
            // 本人团队内层级 == newHierarchy
            if (nm.hierarchy !== r.newHierarchy) {
                detail.ok = false;
                detail.problems.push(`团队内层级=${nm.hierarchy}≠newHierarchy=${r.newHierarchy}`);
                errors.push(`转线：会员 ${uid} 团队内层级=${nm.hierarchy}，与转线记录 newHierarchy=${r.newHierarchy} 不一致`);
            }
            // 附加提示：当前上级是否等于最近转线的新上级
            if (nm.parentId !== r.newParentId) {
                infos.push(`提示：会员 ${uid} 当前上级=${nm.parentId}，与最近转线新上级=${r.newParentId} 不同（可能之后又有变动）`);
            }
        }

        transferredIn.push(detail);
    }

    // 按转入时间倒序，便于阅读
    transferredIn.sort((a, b) => b.transferBeginTime - a.transferBeginTime);

    return { errors, infos, intoTeamCount: transferredIn.length, transferredIn };
}

/**
 * 从当天转线记录推导「野生总代」：某会员最近一条转线记录仍是解绑态(newParentId=0)，
 * 说明他被解绑后没有再绑到任何团队 → 当前卡成了一个独立总代（转线未闭合，通常是 bug）。
 * @param {Array} transferList 当天转线记录
 * @returns {Array<{userId:number, oldParentId:number, oldHierarchy:number, transferBeginTime:number}>}
 */
export function deriveStrayGeneralAgents(transferList) {
    const latest = {};
    for (const r of transferList) {
        if (!r || r.userId == null) continue;
        const cur = latest[r.userId];
        if (!cur || r.transferBeginTime > cur.transferBeginTime) latest[r.userId] = r;
    }
    const strays = [];
    for (const key of Object.keys(latest)) {
        const r = latest[key];
        if (r.newParentId === 0 || r.newParentId == null) {
            strays.push({
                userId: r.userId,
                oldParentId: r.oldParentId,
                oldHierarchy: r.oldHierarchy,
                transferBeginTime: r.transferBeginTime,
            });
        }
    }
    return strays;
}
