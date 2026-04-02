# 3007租户快速开始指南

## 一键创建所有活动

```bash
./run_3007_all_activities.sh
```

## 只创建特定活动

```bash
# 只创建工单系统
./run_3007_all_activities.sh order

# 创建优惠券、签到和工单
./run_3007_all_activities.sh coupon,signin,order

# 创建常用活动
./run_3007_all_activities.sh coupon,signin,inmail,loginPopup,banner,order
```

## 查看执行结果

脚本执行完成后，会显示：
- ✅ 成功创建的活动数量
- ❌ 失败的活动数量
- 📋 详细的失败报告（如有失败）

## 语言支持

3007租户自动使用以下语言：
- 🇨🇳 中文 (zh)
- 🇬🇧 英语 (en)
- 🇵🇰 乌尔都语 (ur)

所有活动的标题和内容会自动生成这3种语言版本。

## 常见问题

### Q: 如何只创建工单系统？
A: `./run_3007_all_activities.sh order`

### Q: 某个活动创建失败怎么办？
A: 查看失败报告中的原因，修复后单独重新创建该活动

### Q: 如何确认活动是否创建成功？
A: 登录后台管理系统，在对应的活动管理页面查看

### Q: 工单系统的FAQ是否支持乌尔都语？
A: 是的，所有25个工单类型都已支持中文、英语、乌尔都语

## 需要帮助？

查看完整文档: `3007_SCRIPT_README.md`
