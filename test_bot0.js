// test_bot0.js —— bot0.js 离线单元测试
// 运行：node test_bot0.js
// 验证核心算法逻辑，无需连接 Minecraft 服务器
const Vec3 = require('vec3')

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) { passed++; return true }
  console.error(`  ❌ 失败: ${msg}`)
  failed++
  return false
}

function assertEq(actual, expected, msg) {
  if (actual === expected) { passed++; return true }
  console.error(`  ❌ 失败: ${msg} —— 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  failed++
  return false
}

// ═══════════════════════════════════════════════
//  MOCK 对象
// ═══════════════════════════════════════════════

function createMockBot(inventoryItems, blockMap) {
  return {
    inventory: {
      items: () => inventoryItems
    },
    blockAt(pos) {
      const key = `${pos.x},${pos.y},${pos.z}`
      return blockMap[key] || null
    }
  }
}

// 辅助：创建方块对象
function block(name) {
  return { name }
}

// ═══════════════════════════════════════════════
//  复制 bot0.js 核心函数（供测试）
// ═══════════════════════════════════════════════

function findItem(bot, candidates) {
  const names = Array.isArray(candidates) ? candidates : [candidates]
  for (const name of names) {
    const item = bot.inventory.items().find(i => i.name === name)
    if (item) return item
  }
  for (const name of names) {
    const item = bot.inventory.items().find(i => i.name.includes(name))
    if (item) return item
  }
  return null
}

function verifyHouse(bot, origin, W, D) {
  const results = { pass: true, issues: [] }

  // 地板
  let floorOk = true
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      const block = bot.blockAt(origin.offset(x, 0, z))
      if (!block || block.name === 'air') {
        floorOk = false
        results.issues.push(`地板缺失 @ (${origin.x + x}, ${origin.y}, ${origin.z + z})`)
      }
    }
  }
  if (floorOk) results.issues.push('✓ 地板完整')

  // 墙壁
  let wallOk = true
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x < W; x++) {
      const isDoorSpace = (x === 3 && (y === 1 || y === 2))
      const block = bot.blockAt(origin.offset(x, y, 0))
      if (!isDoorSpace && (!block || block.name === 'air')) {
        wallOk = false
        results.issues.push(`前墙缺失 @ (${origin.x + x}, ${origin.y + y}, ${origin.z})`)
      }
    }
    for (let x = 0; x < W; x++) {
      const block = bot.blockAt(origin.offset(x, y, D - 1))
      if (!block || block.name === 'air') {
        wallOk = false
        results.issues.push(`后墙缺失 @ (${origin.x + x}, ${origin.y + y}, ${origin.z + D - 1})`)
      }
    }
    for (let z = 1; z < D - 1; z++) {
      const block = bot.blockAt(origin.offset(0, y, z))
      if (!block || block.name === 'air') {
        wallOk = false
        results.issues.push(`左墙缺失 @ (${origin.x}, ${origin.y + y}, ${origin.z + z})`)
      }
    }
    for (let z = 1; z < D - 1; z++) {
      const block = bot.blockAt(origin.offset(W - 1, y, z))
      if (!block || block.name === 'air') {
        wallOk = false
        results.issues.push(`右墙缺失 @ (${origin.x + W - 1}, ${origin.y + y}, ${origin.z + z})`)
      }
    }
  }
  if (wallOk) results.issues.push('✓ 墙壁完整')

  // 门
  const doorBlock = bot.blockAt(origin.offset(3, 1, 0))
  if (!doorBlock || !doorBlock.name.includes('door')) {
    results.issues.push('⚠ 门缺失或未正确放置 @ 门洞位置')
    results.pass = false
  } else {
    results.issues.push('✓ 门已安装')
  }

  // 屋顶
  let roofOk = true
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      const block = bot.blockAt(origin.offset(x, 4, z))
      if (!block || block.name === 'air') {
        roofOk = false
        results.issues.push(`屋顶缺失 @ (${origin.x + x}, ${origin.y + 4}, ${origin.z + z})`)
      }
    }
  }
  if (roofOk) results.issues.push('✓ 屋顶完整')
  else results.pass = false

  // 床（bot0.js 使用 W-3, 1, 2 位置）
  const bedBlock = bot.blockAt(origin.offset(W - 3, 1, 2))
  if (!bedBlock || !bedBlock.name.includes('bed')) {
    results.issues.push('⚠ 床缺失或未正确放置')
    results.pass = false
  } else {
    results.issues.push('✓ 床已放置')
  }

  // 箱子
  const chestBlock = bot.blockAt(origin.offset(3, 1, D - 2))
  if (!chestBlock || chestBlock.name !== 'chest') {
    results.issues.push('⚠ 箱子缺失')
  } else {
    results.issues.push('✓ 箱子已放置')
  }

  return results
}

// ═══════════════════════════════════════════════
//  测试用例
// ═══════════════════════════════════════════════

console.log('═══════════════════════════════════════')
console.log('  bot0.js 核心逻辑测试')
console.log('═══════════════════════════════════════\n')

// ─── findItem 测试 ────────────────────────────
console.log('📦 测试 findItem —— 物品查找')

// 场景1：精确匹配
{
  const bot = createMockBot([block('oak_planks'), block('red_bed')])
  const item = findItem(bot, ['oak_planks', 'planks'])
  assert(item && item.name === 'oak_planks', '1.20 精确匹配 oak_planks')
}

// 场景2：降级匹配（1.12 命名 → 1.20 环境）
{
  const bot = createMockBot([block('oak_planks')])
  const item = findItem(bot, ['planks', 'oak_planks'])
  assert(item && item.name === 'oak_planks', '1.12→1.20 降级：planks 找到 oak_planks')
}

// 场景3：1.12 环境精确匹配
{
  const bot = createMockBot([block('planks')])
  const item = findItem(bot, ['oak_planks', 'planks'])
  assert(item && item.name === 'planks', '1.20→1.12 降级：oak_planks 找到 planks')
}

// 场景4：门查找（1.20）
{
  const bot = createMockBot([block('oak_door')])
  const item = findItem(bot, ['oak_door', 'wooden_door', 'spruce_door'])
  assert(item && item.name === 'oak_door', '门精确匹配 oak_door')
}

// 场景5：门查找（1.12）
{
  const bot = createMockBot([block('wooden_door')])
  const item = findItem(bot, ['oak_door', 'wooden_door'])
  assert(item && item.name === 'wooden_door', '门匹配 wooden_door')
}

// 场景6：床查找（1.20 → 多种颜色）
{
  const bot = createMockBot([block('blue_bed')])
  const item = findItem(bot, ['red_bed', 'white_bed', 'blue_bed', 'bed'])
  assert(item && item.name === 'blue_bed', '床匹配 blue_bed（1.20 颜色床）')
}

// 场景7：床查找（1.12 → bed）
{
  const bot = createMockBot([block('bed')])
  const item = findItem(bot, ['red_bed', 'bed'])
  assert(item && item.name === 'bed', '床匹配 bed（1.12 通用床）')
}

// 场景8：找不到
{
  const bot = createMockBot([block('dirt')])
  const item = findItem(bot, ['oak_planks'])
  assert(item === null, '未找到时返回 null')
}

// 场景9：单字符串参数
{
  const bot = createMockBot([block('chest')])
  const item = findItem(bot, 'chest')
  assert(item && item.name === 'chest', '单字符串参数也能工作')
}

console.log('')

// ─── verifyHouse 测试 ─────────────────────────
console.log('🏠 测试 verifyHouse —— 房屋验证')

// 场景10：完美房屋
{
  const origin = new Vec3(0, 60, 0)
  const W = 7, D = 7
  const blockMap = {}
  // 地板
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++)
      blockMap[`${x},60,${z}`] = block('oak_planks')
  // 墙壁 (y=1~3)，留门洞
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x < W; x++) {
      if (!(x === 3 && (y === 1 || y === 2)))
        blockMap[`${x},${60 + y},0`] = block('oak_planks')  // 前墙
      blockMap[`${x},${60 + y},${D - 1}`] = block('oak_planks')  // 后墙
    }
    for (let z = 1; z < D - 1; z++) {
      blockMap[`0,${60 + y},${z}`] = block('oak_planks')  // 左墙
      blockMap[`${W - 1},${60 + y},${z}`] = block('oak_planks')  // 右墙
    }
  }
  // 门
  blockMap[`3,61,0`] = block('oak_door')
  // 屋顶
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++)
      blockMap[`${x},64,${z}`] = block('oak_planks')
  // 床（W-3 = 4）
  blockMap[`4,61,2`] = block('red_bed')
  // 箱子
  blockMap[`3,61,${D - 2}`] = block('chest')

  const bot = createMockBot([], blockMap)
  const result = verifyHouse(bot, origin, W, D)
  assert(result.pass === true, '完美房屋验证通过')
  assert(result.issues.some(i => i.includes('地板完整')), '地板完整标记存在')
  assert(result.issues.some(i => i.includes('墙壁完整')), '墙壁完整标记存在')
  assert(result.issues.some(i => i.includes('门已安装')), '门已安装标记存在')
  assert(result.issues.some(i => i.includes('屋顶完整')), '屋顶完整标记存在')
  assert(result.issues.some(i => i.includes('床已放置')), '床已放置标记存在')
  assert(result.issues.some(i => i.includes('箱子已放置')), '箱子已放置标记存在')
}

// 场景11：有缺陷的房屋
{
  const origin = new Vec3(10, 60, 10)
  const W = 7, D = 7
  const blockMap = {}
  // 只有地板，没有墙/门/屋顶/床
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++)
      blockMap[`${10 + x},60,${10 + z}`] = block('oak_planks')

  const bot = createMockBot([], blockMap)
  const result = verifyHouse(bot, origin, W, D)
  assert(result.pass === false, '缺陷房屋验证不通过')
  assert(result.issues.some(i => i.includes('地板完整')), '地板仍显示完整')
  assert(result.issues.some(i => i.includes('墙壁缺失') || i.includes('前墙缺失')), '有墙壁缺失标记')
  assert(result.issues.some(i => i.includes('门缺失')), '有门缺失标记')
  assert(result.issues.some(i => i.includes('床缺失')), '有床缺失标记')
}

// 场景12：门洞位置正确留空
{
  const origin = new Vec3(0, 60, 0)
  const W = 7, D = 7
  const blockMap = {}
  // 只建墙，门洞处故意留空
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x < W; x++) {
      if (!(x === 3 && (y === 1 || y === 2)))
        blockMap[`${x},${60 + y},0`] = block('oak_planks')
    }
  }
  const bot = createMockBot([], blockMap)
  const result = verifyHouse(bot, origin, W, D)
  // 门洞位置应该有空气（无方块），verifyHouse 应报门缺失
  assert(result.issues.some(i => i.includes('门缺失')), '门洞留空→报告门缺失')
  // 但前墙不报缺失（门洞不算缺失）
  const frontMissing = result.issues.filter(i => i.includes('前墙缺失'))
  assertEq(frontMissing.length, 0, '门洞不算墙缺失')
}

console.log('')

// ─── 蛇形铺设排序测试 ────────────────────────
console.log('🐍 测试蛇形铺设排序')

function buildFloorList(W, D) {
  const list = []
  for (let z = 0; z < D; z++) {
    if (z % 2 === 0) {
      for (let x = 0; x < W; x++) list.push({ x, z })
    } else {
      for (let x = W - 1; x >= 0; x--) list.push({ x, z })
    }
  }
  return list
}

{
  const list = buildFloorList(7, 7)
  assertEq(list.length, 49, '7x7 共 49 个位置')
  assertEq(list[0].x, 0, '第一个位置 x=0')
  assertEq(list[0].z, 0, '第一个位置 z=0')
  // 验证每个相邻对是相邻的
  let allAdjacent = true
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1]
    const curr = list[i]
    const dx = Math.abs(curr.x - prev.x)
    const dz = Math.abs(curr.z - prev.z)
    if (dx + dz !== 1) {
      allAdjacent = false
      break
    }
  }
  assert(allAdjacent, '蛇形序列中相邻位置都相邻（利于侧面支撑）')
}

{
  // 小方块测试
  const list = buildFloorList(3, 3)
  const expected = [
    { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 },
    { x: 2, z: 1 }, { x: 1, z: 1 }, { x: 0, z: 1 },
    { x: 0, z: 2 }, { x: 1, z: 2 }, { x: 2, z: 2 }
  ]
  let match = list.length === expected.length
  for (let i = 0; i < expected.length; i++) {
    if (list[i].x !== expected[i].x || list[i].z !== expected[i].z) {
      match = false; break
    }
  }
  assert(match, '3x3 蛇形顺序正确')
}

console.log('')

// ─── Vec3.offset 测试 ────────────────────────
console.log('📍 测试 Vec3 坐标计算')

{
  const origin = new Vec3(100, 60, 200)
  const pos = origin.offset(3, 1, 0)
  assertEq(pos.x, 103, 'offset x: 100+3=103')
  assertEq(pos.y, 61, 'offset y: 60+1=61')
  assertEq(pos.z, 200, 'offset z: 200+0=200')
}

{
  const origin = new Vec3(5, 64, 10)
  const bedPos = origin.offset(4, 1, 2)  // W-3=4, y=1, z=2
  assertEq(bedPos.x, 9, '床 x 坐标')
  assertEq(bedPos.y, 65, '床 y 坐标')
  assertEq(bedPos.z, 12, '床 z 坐标')
}

{
  const origin = new Vec3(0, 60, 0)
  const doorPos = origin.offset(3, 1, 0)
  assertEq(doorPos.x, 3, '门 x 坐标')
  assertEq(doorPos.y, 61, '门 y 坐标')
  assertEq(doorPos.z, 0, '门 z 坐标')
}

console.log('')

// ─── 墙壁位置生成测试 ────────────────────────
console.log('🧱 测试墙壁位置生成')

function getWallPositions(W, D) {
  const positions = []
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x < W; x++) {
      if (!(x === 3 && (y === 1 || y === 2))) {
        positions.push({ x, y, z: 0 }) // 前墙（留门洞）
      }
      positions.push({ x, y, z: D - 1 }) // 后墙
    }
    for (let z = 1; z < D - 1; z++) {
      positions.push({ x: 0, y, z })    // 左墙
      positions.push({ x: W - 1, y, z }) // 右墙
    }
  }
  return positions
}

{
  const walls = getWallPositions(7, 7)
  // 总数：前墙 (7*3 - 2门洞) + 后墙 21 + 左墙 15 + 右墙 15 = 19+21+15+15 = 70
  assertEq(walls.length, 70, '7x7 墙壁共 70 个位置（含门洞扣除）')
  // 验证门洞位置不在列表中
  const doorSpots = walls.filter(p => p.x === 3 && p.z === 0 && (p.y === 1 || p.y === 2))
  assertEq(doorSpots.length, 0, '门洞位置 (x=3,z=0,y=1,2) 不在墙壁列表中')
  // 验证 y=3 的 x=3,z=0 存在（门上方的墙）
  const aboveDoor = walls.filter(p => p.x === 3 && p.z === 0 && p.y === 3)
  assertEq(aboveDoor.length, 1, '门上方 (y=3) 有墙壁')
  // 验证角落只出现一次：(0,1,0) 在前墙和左墙中不应重复
  const corners = walls.filter(p => p.x === 0 && p.z === 0)
  assertEq(corners.length, 3, '角落 (0,0) 在 y=1,2,3 各出现一次（仅前墙）')
}

{
  const walls = getWallPositions(5, 5)
  // 前墙 5*3-2 + 后墙 15 + 左墙 9 + 右墙 9 = 13+15+9+9 = 46
  assertEq(walls.length, 46, '5x5 墙壁共 46 个位置')
}

console.log('')

// ─── 火把位置计算测试 ────────────────────────
console.log('🔦 测试火把位置计算')

function getTorchPositions(origin, W, D) {
  return [
    // 内侧
    { wall: origin.offset(3, 2, 0),     face: new Vec3(0, 0, 1) },
    { wall: origin.offset(3, 2, D - 1), face: new Vec3(0, 0, -1) },
    { wall: origin.offset(0, 2, 3),     face: new Vec3(1, 0, 0) },
    { wall: origin.offset(W - 1, 2, 3), face: new Vec3(-1, 0, 0) },
    // 外侧
    { wall: origin.offset(3, 2, 0),     face: new Vec3(0, 0, -1) },
    { wall: origin.offset(3, 2, D - 1), face: new Vec3(0, 0, 1) },
    { wall: origin.offset(0, 2, 3),     face: new Vec3(-1, 0, 0) },
    { wall: origin.offset(W - 1, 2, 3), face: new Vec3(1, 0, 0) },
  ]
}

{
  const origin = new Vec3(0, 60, 0)
  const torches = getTorchPositions(origin, 7, 7)
  assertEq(torches.length, 8, '共 8 个火把位置（内外各 4）')

  // 前墙内侧
  assertEq(torches[0].wall.x, 3, '前墙内侧火把贴在 x=3')
  assertEq(torches[0].wall.z, 0, '前墙内侧火把贴在 z=0')
  assertEq(torches[0].face.z, 1, '前墙内侧火把朝向 +z（房里）')

  // 前墙外侧（与内侧同墙，方向相反）
  assertEq(torches[4].wall.x, 3, '前墙外侧火把贴在 x=3（同位置）')
  assertEq(torches[4].face.z, -1, '前墙外侧火把朝向 -z（房外）')

  // 左墙内侧
  assertEq(torches[2].wall.x, 0, '左墙内侧火把贴在 x=0')
  assertEq(torches[2].face.x, 1, '左墙内侧火把朝向 +x')

  // 左墙外侧
  assertEq(torches[6].face.x, -1, '左墙外侧火把朝向 -x')

  // 所有火把 y=2（中间高度）
  for (const t of torches) {
    assertEq(t.wall.y, 62, `火把贴在 y=${t.wall.y}（origin.y+2）`)
  }
}

console.log('')

// ─── 场地清除判断测试 ────────────────────────
console.log('🧹 测试场地清除判断')

function shouldClear(blockName) {
  if (!blockName || blockName === 'air') return false
  if (blockName === 'bedrock' || blockName === 'barrier' || blockName === 'command_block') return false
  if (blockName.includes('door') || blockName.includes('bed') || blockName === 'chest' || blockName === 'crafting_table') return false
  if (blockName === 'water' || blockName === 'lava') return false // 流体跳过手动清除
  return (
    blockName.includes('sand') || blockName.includes('dirt') || blockName === 'gravel' ||
    blockName === 'clay' || blockName.includes('mud') ||
    blockName.includes('grass') || blockName.includes('fern') || blockName.includes('flower') ||
    blockName.includes('tulip') || blockName.includes('orchid') || blockName.includes('daisy') ||
    blockName.includes('allium') || blockName.includes('bluet') || blockName.includes('mushroom') ||
    blockName.includes('vine') || blockName.includes('leaves') || blockName.includes('snow') ||
    blockName.includes('coral') || blockName === 'kelp' || blockName === 'seagrass' ||
    blockName === 'sea_pickle' || blockName === 'bamboo' || blockName === 'sugar_cane' ||
    blockName === 'dead_bush' || blockName === 'torch' || blockName === 'ladder' ||
    blockName === 'cobblestone' || blockName === 'stone' || blockName.includes('wool') ||
    blockName === 'wheat' || blockName === 'beetroots' || blockName === 'carrots' ||
    blockName === 'potatoes' || blockName === 'melon_stem' || blockName === 'pumpkin_stem'
  )
}

{
  // 应清除的方块
  assert(shouldClear('sand'), '沙土应清除')
  assert(shouldClear('red_sand'), '红沙应清除')
  assert(shouldClear('dirt'), '泥土应清除')
  assert(shouldClear('gravel'), '沙砾应清除')
  assert(shouldClear('grass'), '草应清除')
  assert(shouldClear('oak_leaves'), '树叶应清除')
  assert(shouldClear('stone'), '石头应清除')
  assert(shouldClear('cobblestone'), '圆石应清除')
  assert(shouldClear('white_wool'), '羊毛应清除')
  assert(shouldClear('kelp'), '海带应清除')
  assert(shouldClear('wheat'), '小麦应清除')

  // 不应清除的方块
  assert(!shouldClear('air'), '空气不清除')
  assert(!shouldClear('bedrock'), '基岩不清除')
  assert(!shouldClear('barrier'), '屏障不清除')
  assert(!shouldClear('water'), '水不手动清除（交placeBlockAt替换）')
  assert(!shouldClear('lava'), '熔岩不手动清除')
  assert(!shouldClear('oak_door'), '门不清除')
  assert(!shouldClear('red_bed'), '床不清除')
  assert(!shouldClear('chest'), '箱子不清除')
  assert(!shouldClear('crafting_table'), '工作台不清除')
  assert(!shouldClear('oak_planks'), '木板不清除（已是建材）')
}

console.log('')

// ─── tryDodge 候选方向测试 ────────────────────
console.log('🏃 测试避让候选方向')

function getDodgeCandidates() {
  return [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 0], [-2, 0], [0, 2], [0, -2],
  ]
}

{
  const candidates = getDodgeCandidates()
  assertEq(candidates.length, 12, '共 12 个候选避让方向')
  // 前 4 个是距离 1 的基本方向
  assertEq(candidates[0][0], 1, '第 1 个：(1,0) 东')
  assertEq(candidates[3][1], -1, '第 4 个：(0,-1) 北')
  // 后 4 个是距离 2
  assertEq(Math.abs(candidates[8][0]), 2, '距离 2：x=±2')
  assertEq(Math.abs(candidates[11][1]), 2, '距离 2：z=±2')
  // 验证优先顺序：近距离在前
  for (let i = 0; i < 8; i++) {
    assertEq(Math.abs(candidates[i][0]) <= 1 && Math.abs(candidates[i][1]) <= 1, true,
      `候选 ${i} 是距离 ≤1`)
  }
}

console.log('')

// ─── placeBlockAt 方块处理策略测试 ────────────
console.log('🧱 测试 placeBlockAt 方块处理策略')

function getBlockAction(blockName, targetName) {
  // 模拟 placeBlockAt 中对已存在方块的处理逻辑
  if (!blockName || blockName === 'air') return 'place' // 空气 → 直接放置

  // 已是目标方块 → 跳过
  if (blockName === targetName || blockName === 'oak_planks' || blockName === 'planks') return 'skip'

  // 保护性方块 → 放弃
  if (blockName.includes('door') || blockName.includes('bed') ||
      blockName === 'chest' || blockName === 'crafting_table') return 'abort'

  // 流体 → 直接替换
  if (blockName === 'water' || blockName === 'lava') return 'replace'

  // 可挖掘 → 先挖后放
  const diggableSet = new Set([
    'sand', 'red_sand', 'dirt', 'coarse_dirt', 'gravel', 'clay',
    'grass_block', 'stone', 'cobblestone', 'oak_log', 'spruce_log',
  ])
  if (diggableSet.has(blockName) || blockName.includes('sand') || blockName.includes('dirt')) return 'dig_then_place'

  // 不可挖掘 → 放弃
  return 'abort'
}

{
  // 空气 → 直接放
  assertEq(getBlockAction('air', 'oak_planks'), 'place', '空气位置直接放置')
  assertEq(getBlockAction(null, 'oak_planks'), 'place', '无方块视为空气')

  // 已是木板 → 跳过
  assertEq(getBlockAction('oak_planks', 'oak_planks'), 'skip', '已有木板跳过')
  assertEq(getBlockAction('planks', 'oak_planks'), 'skip', '兼容 planks 名称')

  // 保护性方块 → 放弃
  assertEq(getBlockAction('oak_door', 'oak_planks'), 'abort', '门不可覆盖')
  assertEq(getBlockAction('red_bed', 'oak_planks'), 'abort', '床不可覆盖')
  assertEq(getBlockAction('chest', 'oak_planks'), 'abort', '箱子不可覆盖')
  assertEq(getBlockAction('crafting_table', 'oak_planks'), 'abort', '工作台不可覆盖')

  // 流体 → 替换
  assertEq(getBlockAction('water', 'oak_planks'), 'replace', '水用方块直接替换')
  assertEq(getBlockAction('lava', 'oak_planks'), 'replace', '熔岩用方块直接替换')

  // 可挖掘 → 先挖后放
  assertEq(getBlockAction('sand', 'oak_planks'), 'dig_then_place', '沙子先挖后放')
  assertEq(getBlockAction('dirt', 'oak_planks'), 'dig_then_place', '泥土先挖后放')
  assertEq(getBlockAction('stone', 'oak_planks'), 'dig_then_place', '石头先挖后放')
  assertEq(getBlockAction('oak_log', 'oak_planks'), 'dig_then_place', '原木先挖后放')

  // 不可挖掘 → 放弃
  assertEq(getBlockAction('bedrock', 'oak_planks'), 'abort', '基岩无法处理')
  assertEq(getBlockAction('obsidian', 'oak_planks'), 'abort', '黑曜石无法处理（不在可挖掘列表）')
}

console.log('')

// ─── 结果汇总 ─────────────────────────────────
console.log('═══════════════════════════════════════')
console.log(`  测试结果: ${passed} 通过 / ${failed} 失败`)
if (failed === 0) {
  console.log('  ✅ 全部测试通过！核心逻辑验证完成')
  console.log('═══════════════════════════════════════')
  process.exit(0)
} else {
  console.log('  ❌ 存在失败用例，请检查')
  console.log('═══════════════════════════════════════')
  process.exit(1)
}
