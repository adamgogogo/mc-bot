# 架构文档

> bot0.js 模块关系与数据流

## 文件概览

```
bot0.js  (~1765 行，单文件架构)
├── 1. 日志系统 (L1-L12)
├── 2. 依赖 & 配置 (L13-L42)
├── 3. 持久化层 (L44-L69)
├── 4. 碰撞 & 选址 (L75-L230)
├── 5. Bot 创建 & 插件 (L235-L270)
├── 6. 工具函数 (L272-L650)
├── 7. 房屋验证 (L650-L720)
├── 8. 建房引擎 (L720-L1180)
├── 9. 围墙引擎 (L1180-L1480)
├── 10. 批量建房 (L1480-L1550)
└── 11. 事件处理 (L1550-L1765)
```

## 核心模块

```
┌─────────────────────────────────────────────────────┐
│                   Chat 命令层                        │
│  set center / build wall / build house / repair    │
│  build random / houses / inv / come / continue     │
└──────────────┬──────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────┐
│                 业务逻辑层                           │
│                                                     │
│  buildHouse()         buildWall()                   │
│  buildRandomHouses()  repairWall()                  │
│  findRandomBuildSpot() findWallRadius()            │
│  ensureMaterials()    verifyHouse()                 │
│                                                     │
└──────┬──────────────────────┬───────────────────────┘
       ↓                      ↓
┌──────────────┐    ┌──────────────────┐
│  导航层       │    │  物品层           │
│              │    │                  │
│ walkTo()     │    │ findItem()       │
│ placeBlockAt()│   │ ensureEquip()    │
│ placeBlockRace()│  │ ensureMaterials()│
│ placeTorchOnWall()│                  │
│ placeDoorAt()│    └──────────────────┘
│ placeBedAt() │
│ tryDodge()   │
└──────┬───────┘
       ↓
┌──────────────────┐
│  mineflayer API   │
│                  │
│ bot.pathfinder    │
│ bot.blockAt()     │
│ bot.dig()         │
│ bot.chat()        │
│ bot.inventory     │
└──────────────────┘
```

## 数据流

```
用户聊天命令
  ↓
Chat 事件 (bot.on('chat'))
  ↓ 解析命令
  ├→ buildHouse(origin, shapeKey)
  │   ├→ ensureMaterials(shapeKey)     ← 物品检查
  │   ├→ walkTo() + placeBlockAt()     ← 移动 + 放方块
  │   ├→ verifyHouse()                 ← 验证
  │   └→ placeTorchOnWall()            ← 装饰
  │
  ├→ buildRandomHouses(count)
  │   ├→ randomShapeKey()              ← 随机形状
  │   ├→ findRandomBuildSpot()         ← 选址
  │   │   ├→ isOverlapping()           ← 碰撞检测
  │   │   └→ bot.blockAt()             ← 地表扫描
  │   └→ buildHouse(origin, shapeKey)  ← 建房
  │
  ├→ buildWall(radius)
  │   ├→ findWallRadius()              ← 扫描可行半径
  │   │   └→ canBuildWallAt()          ← 单点检测
  │   ├→ scanGround()                  ← 地表扫描
  │   └→ placeBlockAt()                ← 逐格建墙
  │
  └→ repairWall(radius)
      ├→ 已有墙检测
      └→ checkAndFix()                 ← 逐格检查修复
```

## 关键数据结构

```javascript
// 形状配置
HOUSE_SHAPES = {
  small:    { w:5, d:5, wallH:3, roof:'flat' },
  standard: { w:7, d:7, wallH:4, roof:'flat' },
  long:     { w:9, d:5, wallH:4, roof:'flat' },
  tower:    { w:5, d:5, wallH:8, roof:'flat' },
  triangle: { w:7, d:7, wallH:4, roof:'triangle' },
}

// 已建房屋
builtHouses = [{ origin:{x,y,z}, shape:'standard' }, ...]

// 建房中心
buildCenter = { x, y, z, wallRadius }
```

## 测试架构

```
test_bot0.js  (152 测试)
├── findItem 测试
├── verifyHouse 测试 (含三角屋顶)
├── 蛇形铺设排序测试
├── 墙壁位置生成测试
├── 火把位置计算测试
├── 场地清除判断测试
├── 避让候选方向测试
├── placeBlockAt 处理策略测试
├── isOverlapping 碰撞检测测试
├── findRandomBuildSpot 选址测试
├── walkTo 距离预检测试
├── placeTorchOnWall mock 测试 (5 分支)
├── 补墙逻辑测试 (94 位置)
├── 围墙坐标测试
├── 建房中心逻辑测试
└── 悬崖垂直检测测试

test_wall.js  (独立建墙测试脚本)
├── 连接服务器
├── scanGround + findWallRadius
├── 逐层建墙
└── 验证墙完整性
```

## 依赖关系

```
外部依赖:
  mineflayer           ← Bot 核心
  mineflayer-pathfinder ← 寻路
  vec3                  ← 3D 向量
  minecraft-data        ← 方块注册表

内置依赖:
  fs      ← 持久化 (houses.json, center.json, bot0.log)
  path    ← 路径拼接
```
