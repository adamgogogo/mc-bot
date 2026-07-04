# 项目简介

基于 mineflayer 的 Minecraft 1.20.4 自动建房 Bot，支持 5 种形状随机批量建房和围墙系统。

目标：
- 自动批量建房（最多 100 栋不重叠）
- 自动建围墙（自动适配地形）
- 智能选址（避水/悬崖/洞穴/地下）

---

# 项目结构

```
mc-bot/
├── bot0.js          # 主 Bot（建房+围墙+选址+材料管理）
├── bot.js           # 基础版 Bot
├── test_bot0.js     # 单元测试（152 通过）
├── test_wall.js     # 围墙独立测试脚本
├── houses.json      # 已建房屋记录（持久化）
├── center.json      # 建房中心（持久化）
├── bot0.log         # 运行日志
└── README.md        # 项目文档
```

核心模块（均在 bot0.js 内）：

| 模块 | 函数 |
|------|------|
| 建房 | `buildHouse`, `buildRandomHouses` |
| 围墙 | `buildWall`, `repairWall`, `findWallRadius` |
| 选址 | `findRandomBuildSpot`, `isOverlapping` |
| 导航 | `walkTo`, `placeBlockAt`, `placeTorchOnWall` |
| 材料 | `ensureMaterials`, `findItem`, `ensureEquip` |
| 持久化 | `saveHouses`, `saveCenter` |
| 形状 | `HOUSE_SHAPES` (small/standard/long/tower/triangle) |

---

# 主入口

`bot0.js`，负责：

- 登录 Minecraft 服务器（192.168.1.5）
- 初始化 pathfinder 插件
- 注册 chat 事件处理命令
- 加载持久化数据（houses.json / center.json）

---

# 模块关系

```
chat 命令
  ↓
buildHouse / buildRandomHouses / buildWall / repairWall
  ↓
findRandomBuildSpot / findWallRadius（选址扫描）
  ↓
walkTo + placeBlockAt（移动 + 放置方块）
  ↓
findItem + ensureEquip（物品管理）
```

---

# 已完成

- 5 种形状随机建房（small / standard / long / tower / triangle）
- 碰撞检测（x/y/z 3D AABB）
- 智能选址（地表扫描 + 悬崖/水下/洞穴过滤 + 坡度检测）
- 材料自动补充（/give + 不足暂停等待 continue）
- 围墙建造（自动适配地形，避水/悬崖/树干）
- 围墙修复（顺时针走查 + 火把补插）
- 打破墙补墙离开
- 建房中心持久化
- 房屋记录持久化
- 152 单元测试覆盖核心逻辑

---

# 未完成

- 复杂 3D 地形上自动寻路（pathfinder 限制）
- 战斗 AI
- 挖矿
- 多 Bot 协作

---

# 已知问题

- walkTo 在高低差地形（如从墙顶下地面）会超时
- placeBlockRace 超时 2s 导致建墙缓慢
- pathfinder 无法在悬崖/树干间找路上坡
- localhost 无法直接连接服务器（需要局域网 IP）

---

# 开发规范

- 修改后运行 `node test_bot0.js` 验证（152 测试）
- 提交格式：`feat/fix/docs: 描述 (xxxpass) Money:~$X.XX Tokens:~XK+XK`
- 线上只保留 main 分支，其他为本地开发分支
- 不使用系统命令（/setblock 等），用 Bot API
- 修改前先分析原因，不删除已有功能
