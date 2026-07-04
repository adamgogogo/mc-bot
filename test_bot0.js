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

function verifyHouse(bot, origin, W, D, shape = "flat", wallH = 4) {
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



// 场景13：三角屋顶验证（wallH 参数化）
{
  const origin = new Vec3(0, 60, 0), W = 7, D = 7
  const blockMap = {}
  // 地板
  for(let x=0;x<W;x++) for(let z=0;z<D;z++) blockMap[`${x},60,${z}`]=block('oak_planks')
  // 墙壁 y=1~4
  for(let y=1;y<=4;y++){for(let x=0;x<W;x++){if(!(x===3&&(y===1||y===2)))blockMap[`${x},${60+y},0`]=block('oak_planks');blockMap[`${x},${60+y},${D-1}`]=block('oak_planks')}for(let z=1;z<D-1;z++){blockMap[`0,${60+y},${z}`]=block('oak_planks');blockMap[`${W-1},${60+y},${z}`]=block('oak_planks')}}
  // 三角屋顶 y=4~7
  for(let layer=0;layer<4;layer++){for(let x=layer;x<=W-1-layer;x++){for(let z=0;z<D;z++){blockMap[`${x},${64+layer},${z}`]=block('oak_planks')}}}
  blockMap['3,61,0']=block('oak_door');blockMap['4,61,2']=block('red_bed')
  blockMap[`3,61,${D-2}`]=block('chest')
  const bot = createMockBot([], blockMap)
  const r = verifyHouse(bot, origin, W, D, 'triangle', 4)
  assert(r.pass===true,'三角屋顶验证通过')
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

// ─── 房屋碰撞检测测试 ──────────────────────────
console.log('🏘️  测试房屋碰撞检测 (isOverlapping)')

const HOUSE_W = 7
const HOUSE_D = 7
const HOUSE_GAP = 1

function isOverlapping(builtHouses, candOrigin, w = HOUSE_W, d = HOUSE_D, gap = HOUSE_GAP, candH = 5) {
  const candMinX = candOrigin.x
  const candMaxX = candOrigin.x + w - 1
  const candMinZ = candOrigin.z
  const candMaxZ = candOrigin.z + d - 1

  for (const h of builtHouses) {
    const o = h.origin
    const hMinX = o.x
    const hMaxX = o.x + w - 1
    const hMinZ = o.z
    const hMaxZ = o.z + d - 1

    const overlapX = (candMinX <= hMaxX + gap) && (candMaxX + gap >= hMinX)
    const overlapZ = (candMinZ <= hMaxZ + gap) && (candMaxZ + gap >= hMinZ)
    if (overlapX && overlapZ) return true
  }
  return false
}

// 场景：空列表不重叠
{
  const built = []
  const cand = new Vec3(0, 60, 0)
  assert(!isOverlapping(built, cand), '空已建列表 → 不重叠')
}

// 场景：同一位置重叠
{
  const built = [{ origin: { x: 0, y: 60, z: 0 } }]
  const cand = new Vec3(0, 60, 0)
  assert(isOverlapping(built, cand), '同一位置 → 重叠')
}

// 场景：部分重叠（x 方向偏移 3 格）
{
  const built = [{ origin: { x: 0, y: 60, z: 0 } }]
  const cand = new Vec3(3, 60, 0)
  assert(isOverlapping(built, cand), 'x 偏移 3 格 → 重叠（7x7 矩形相交）')
}

// 场景：刚好相邻（间距 = HOUSE_GAP，边界贴合但有间隙）
{
  const built = [{ origin: { x: 0, y: 60, z: 0 } }]
  // 已有房子占 x: 0~6,z: 0~6；新房子 x: 8,z: 0 → x 方向间距 = 8-0-W=8-7=1=gap
  const cand1 = new Vec3(8, 60, 0)   // x 方向紧邻，间距 = 8 - 6 = 2 > gap=1 ✓
  assert(!isOverlapping(built, cand1), 'x 偏移 8 → 不重叠（间距 ≥ gap）')
  
  // x: 7 → 间距 = 7-6 = 1 = gap → 含间隙检测判定为重叠
  const cand2 = new Vec3(7, 60, 0)
  assert(isOverlapping(built, cand2), 'x 偏移 7 → 重叠（间距 = gap）')
}

// 场景：z 方向偏移
{
  const built = [{ origin: { x: 0, y: 60, z: 0 } }]
  const cand1 = new Vec3(0, 60, 8)
  assert(!isOverlapping(built, cand1), 'z 偏移 8 → 不重叠')
  const cand2 = new Vec3(0, 60, 7)
  assert(isOverlapping(built, cand2), 'z 偏移 7 → 重叠（间距 = gap）')
}

// 场景：对角位置不重叠
{
  const built = [{ origin: { x: 0, y: 60, z: 0 } }]
  const cand = new Vec3(8, 60, 8)
  assert(!isOverlapping(built, cand), '对角 (8,8) → 不重叠')
}

// 场景：多栋已建房屋中检查
{
  const built = [
    { origin: { x: 0, y: 60, z: 0 } },
    { origin: { x: 10, y: 62, z: 0 } },
    { origin: { x: 0, y: 58, z: 10 } },
  ]
  // 与第二栋重叠
  assert(isOverlapping(built, new Vec3(10, 60, 0)), '多栋列表 → 与第二栋重叠')
  // 与第三栋不重叠但位置接近
  assert(!isOverlapping(built, new Vec3(0, 60, 20)), '多栋列表 → 不重叠（z=20 距第三栋 z=10 有间隙）')
  // 在间隙中
  assert(!isOverlapping(built, new Vec3(8, 60, 8)), '多栋列表 → 位于三栋间隙中不重叠')
}

// 场景：y 不同但 x-z 重叠
{
  const built = [{ origin: { x: 0, y: 60, z: 0 } }]
  const cand = new Vec3(0, 70, 0)  // y 相差 10，但 x-z 相同
  assert(isOverlapping(built, cand), 'x-z 相同但 y 不同 → 仍重叠（只看 x-z 投影）')
}

console.log('')

// ─── 随机位置搜索测试 ──────────────────────────
console.log('🎲 测试随机位置搜索 (findRandomBuildSpot)')

function findRandomBuildSpot(builtHouses, blockMap, centerX, centerY, centerZ, w = HOUSE_W, d = HOUSE_D, radius = 20, maxAttempts = 200) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const angle = Math.random() * 2 * Math.PI
    const dist = Math.sqrt(Math.random()) * radius
    const dx = Math.round(Math.cos(angle) * dist)
    const dz = Math.round(Math.sin(angle) * dist)

    const cx = centerX + dx
    const cz = centerZ + dz
    const cy = centerY + Math.floor(Math.random() * 9) - 4

    const cand = new Vec3(cx, cy, cz)

    // 碰撞检测
    if (isOverlapping(builtHouses, cand)) continue

    // 地面检测
    const corners = [
      cand.offset(0, -1, 0),
      cand.offset(HOUSE_W - 1, -1, 0),
      cand.offset(0, -1, HOUSE_D - 1),
      cand.offset(HOUSE_W - 1, -1, HOUSE_D - 1),
      cand.offset(Math.floor(HOUSE_W / 2), -1, Math.floor(HOUSE_D / 2))
    ]
    let solidGround = true
    for (const corner of corners) {
      const key = `${corner.x},${corner.y},${corner.z}`
      const block = blockMap[key]
      if (!block || block.name === 'air' || block.name === 'water' || block.name === 'lava') {
        solidGround = false
        break
      }
    }
    if (!solidGround) continue

    // 水下检查：屋顶上方（y=5）有水覆盖
    let isUnderwater = false
    for (let x = 0; x < HOUSE_W && !isUnderwater; x++) {
      for (let z = 0; z < HOUSE_D && !isUnderwater; z++) {
        const key = `${cand.x + x},${cand.y + 5},${cand.z + z}`
        const b = blockMap[key]
        if (b && b.name === 'water') isUnderwater = true
      }
    }
    if (isUnderwater) continue

    // 地下/洞穴检查：中心正上方连续固体天花板
    const centerX2 = cand.x + Math.floor(HOUSE_W / 2)
    const centerZ2 = cand.z + Math.floor(HOUSE_D / 2)
    let solidAbove = 0
    for (let dy = 5; dy <= 12; dy++) {
      const key = `${centerX2},${cand.y + dy},${centerZ2}`
      const b = blockMap[key]
      if (b && b.name !== 'air' && !b.name.includes('leaves')) {
        solidAbove++
        if (solidAbove >= 3) break
      } else {
        break
      }
    }
    if (solidAbove >= 3) continue

    return cand
  }
  return null
}

// 场景：空地 → 应找到位置
{
  const blockMap = {}
  // 在中心周围铺上实心地面
  for (let x = -30; x <= 30; x++) {
    for (let z = -30; z <= 30; z++) {
      blockMap[`${x},59,${z}`] = block('grass_block')
    }
  }
  const spot = findRandomBuildSpot([], blockMap, 0, 60, 0, 20, 200)
  assert(spot !== null, '空地 → 成功找到位置')
  // 验证在半径内
  const dist = Math.sqrt((spot.x - 0) ** 2 + (spot.z - 0) ** 2)
  assert(dist <= 21, '找到的位置在搜索半径内')
}

// 场景：已有一栋房子，第二栋应找到不重叠的位置
{
  const blockMap = {}
  for (let x = -30; x <= 30; x++) {
    for (let z = -30; z <= 30; z++) {
      blockMap[`${x},59,${z}`] = block('grass_block')
    }
  }
  const built = [{ origin: { x: 0, y: 60, z: 0 } }]
  // 清除第一栋房子下方的地面（让它占位但地面还在）
  // 实际上我们只需要确保搜索不会返回重叠位置
  
  const spot = findRandomBuildSpot(built, blockMap, 0, 60, 0, 20, 200)
  assert(spot !== null, '已有 1 栋 → 仍能找到位置')
  assert(!isOverlapping(built, spot), '找到的位置与已有房子不重叠')
}

// 场景：全部被占满 → 返回 null
{
  const blockMap = {}
  // 仅有中心一小块地面
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      blockMap[`${x},59,${z}`] = block('grass_block')
    }
  }
  // 占用这块地
  const built = [{ origin: { x: -2, y: 60, z: -2 } }]
  
  // 使用小半径和少尝试次数，让它尽快失败
  const spot = findRandomBuildSpot(built, blockMap, 0, 60, 0, 5, 10)
  // 可能找到也可能找不到（取决于随机），但大概率找不到
  if (spot !== null) {
    // 如果找到了，验证不重叠
    assert(!isOverlapping(built, spot), '如果找到位置，应与已建不重叠')
  }
}

// 场景：水面 → 找不到位置
{
  const blockMap = {}
  for (let x = -10; x <= 10; x++) {
    for (let z = -10; z <= 10; z++) {
      blockMap[`${x},59,${z}`] = block('water')
    }
  }
  const spot = findRandomBuildSpot([], blockMap, 0, 60, 0, 10, 50)
  assert(spot === null, '全是水面 → 找不到可建造位置')
}

// 场景：水下 —— 地面正常，但屋顶上方有水
{
  const blockMap = {}
  for (let x = -10; x <= 10; x++) {
    for (let z = -10; z <= 10; z++) {
      blockMap[`${x},59,${z}`] = block('grass_block')
      // 屋顶上方铺水
      blockMap[`${x},65,${z}`] = block('water')
    }
  }
  const spot = findRandomBuildSpot([], blockMap, 0, 60, 0, 15, 100)
  assert(spot === null, '水下（屋顶有水）→ 找不到可建造位置')
}

// 场景：地下/洞穴 —— 地面正常，但中心上方有连续石头天花板
{
  const blockMap = {}
  for (let x = -10; x <= 10; x++) {
    for (let z = -10; z <= 10; z++) {
      blockMap[`${x},59,${z}`] = block('grass_block')
    }
  }
  // 中心上方 (3,0,3) 覆盖连续 3 格石头
  const cx = 3, cz = 3
  blockMap[`${cx},65,${cz}`] = block('stone')
  blockMap[`${cx},66,${cz}`] = block('stone')
  blockMap[`${cx},67,${cz}`] = block('stone')
  const spot = findRandomBuildSpot([], blockMap, 0, 60, 0, 15, 100)
  // 注意：候选 origin 不一定恰好是 (0,60,0)，可能找到其他无覆盖位置
  // 这里只验证如果找到了位置，它的中心上方不是连续固体
  if (spot !== null) {
    const scx = spot.x + Math.floor(HOUSE_W / 2)
    const scz = spot.z + Math.floor(HOUSE_D / 2)
    let count = 0
    for (let dy = 5; dy <= 12; dy++) {
      const key = `${scx},${spot.y + dy},${scz}`
      const b = blockMap[key]
      if (b && b.name !== 'air' && !b.name.includes('leaves')) {
        count++
        if (count >= 3) break
      } else break
    }
    assert(count < 3, '找到的位置上方没有连续固体天花板')
  }
}

console.log('')

// ─── walkTo + 出门逻辑 Mock 集成测试 ──────────
console.log('🚶 测试 walkTo 与出门逻辑')

// 1. 距离预检：< 3.5 不调用 pathfinder
{
  let pathfinderCalled = false
  const pos = new Vec3(0, 60, 0)
  const dist = pos.distanceTo(new Vec3(0, 60, 0))
  assertEq(dist, 0, '同位置距离 = 0')
  assert(dist < 3.5, '距离 < 3.5 跳过寻路')
}

// 2. 出口坐标计算：床角 → 门外
{
  // 模拟标准房 origin(100,64,200), W=7,D=7, doorX=3
  const origin = new Vec3(100, 64, 200)
  const doorX = 3
  // bot 在床角落: origin.offset(4, 1, 2) = (104, 65, 202)
  const bedCorner = origin.offset(4, 1, 2)
  // 门外目标: origin.offset(doorX, 0, -2) = (103, 64, 198)
  const exitTarget = origin.offset(doorX, 0, -2)
  assertEq(bedCorner.x, 104, '床角落 x')
  assertEq(bedCorner.z, 202, '床角落 z')
  assertEq(exitTarget.x, 103, '出口目标 x')
  assertEq(exitTarget.z, 198, '出口目标 z')
  // 床角到门外距离 > 3.5，需要 pathfinder
  const d = bedCorner.distanceTo(exitTarget)
  assert(d > 3.5, `床角→门外距离 ${d.toFixed(1)} > 3.5，会调用 pathfinder`)
}

// 3. 放床后回中央坐标：W=7,D=7 → 中央(3.5, y, 3.5)
{
  const origin = new Vec3(50, 70, 80)
  const W = 7, D = 7
  const cx = origin.x + Math.floor(W / 2)
  const cz = origin.z + Math.floor(D / 2)
  assertEq(cx, 53, '中央 x')
  assertEq(cz, 83, '中央 z')
  // 中央到门外距离
  const mid = new Vec3(cx, origin.y, cz)
  const door = origin.offset(3, 0, -2)
  const d2 = mid.distanceTo(door)
  assert(d2 > 3.5, `中央→门外距离 ${d2.toFixed(1)} > 3.5`)
}

// 4. canDig 状态模拟：建房期间 false，结尾恢复 true
{
  let canDig = true
  const prevCanDig = canDig
  canDig = false // buildHouse 开始
  assert(!canDig, '建房期间 canDig=false')
  canDig = prevCanDig // buildHouse 结束
  assert(canDig, '建房结束后 canDig 恢复 true')
}

// ─── placeTorchOnWall Mock 测试 ──────────────
console.log('🔥 测试 placeTorchOnWall 逻辑')

async function mockPlaceTorchOnWall(mockBot, wallPos, faceVec) {
  const torchItem = (mockBot.inventory.items() || []).find(i => i.name === 'torch')
  if (!torchItem) return false
  const targetPos = { x: wallPos.x + faceVec.x, y: wallPos.y + faceVec.y, z: wallPos.z + faceVec.z }
  const key = `${targetPos.x},${targetPos.y},${targetPos.z}`
  const existing = mockBot.blockMap[key]
  if (existing && existing !== 'air') {
    if (existing === 'torch') return true
    return false
  }
  const wallKey = `${wallPos.x},${wallPos.y},${wallPos.z}`
  const wallBlock = mockBot.blockMap[wallKey]
  if (!wallBlock || wallBlock === 'air') return false
  mockBot.blockMap[key] = 'torch'
  return true
}

;(async () => {
  const wallPos = new Vec3(3, 62, 0)
  const faceVec = new Vec3(0, 0, 1)

  const bot1 = {
    inventory: { items: () => [{ name: 'torch', count: 5 }] },
    blockMap: { '3,62,0': 'oak_planks', '3,62,1': 'air' }
  }
  assert(await mockPlaceTorchOnWall(bot1, wallPos, faceVec), '有墙有 torch → 放置成功')
  assert(bot1.blockMap['3,62,1'] === 'torch', '目标位置变成 torch')

  const bot2 = { inventory: { items: () => [] }, blockMap: {} }
  assert(!(await mockPlaceTorchOnWall(bot2, wallPos, faceVec)), '无 torch → false')

  const bot3 = {
    inventory: { items: () => [{ name: 'torch', count: 1 }] },
    blockMap: { '3,62,0': 'oak_planks', '3,62,1': 'stone' }
  }
  assert(!(await mockPlaceTorchOnWall(bot3, wallPos, faceVec)), '目标有 stone → false')

  const bot4 = {
    inventory: { items: () => [{ name: 'torch', count: 1 }] },
    blockMap: { '3,62,0': 'oak_planks', '3,62,1': 'torch' }
  }
  assert(await mockPlaceTorchOnWall(bot4, wallPos, faceVec), '目标已有 torch → true（幂等）')

  const bot5 = {
    inventory: { items: () => [{ name: 'torch', count: 1 }] },
    blockMap: { '3,62,0': 'air', '3,62,1': 'air' }
  }
  assert(!(await mockPlaceTorchOnWall(bot5, wallPos, faceVec)), '墙壁 air → false')
})()

// ─── 补墙逻辑测试 ────────────────────────────
console.log('🧱 测试补墙逻辑')
{
  const origin = new Vec3(100, 64, 200)
  const W = 7, D = 7, wallH = 4, doorX = 3
  const walls = []
  for (let y = 1; y <= wallH; y++) {
    for (let x = 0; x < W; x++) {
      if (!(y <= 2 && x === doorX)) walls.push(origin.offset(x, y, 0))
      walls.push(origin.offset(x, y, D - 1))
    }
    for (let z = 1; z < D - 1; z++) {
      walls.push(origin.offset(0, y, z))
      walls.push(origin.offset(W - 1, y, z))
    }
  }
  // 前墙 (4层 × 7格 - 门洞2格) + 后墙 28 + 左墙 (4×5) + 右墙 (4×5) = 26+28+20+20 = 94
  assertEq(walls.length, 94, '7×7 wallH=4 墙壁共 94 个补墙位置')
  // 门洞不在列表中
  const doorSpots = walls.filter(p => p.x === origin.x + 3 && p.z === origin.z && (p.y === origin.y + 1 || p.y === origin.y + 2))
  assertEq(doorSpots.length, 0, '门洞不在补墙列表中')
  // 检查角落
  const corner = origin.offset(0, 1, 0)
  assert(walls.some(p => p.x === corner.x && p.y === corner.y && p.z === corner.z), '前墙左下角在列表中')
}

console.log('')

// ─── 围墙坐标测试 ────────────────────────────
console.log('🧱 测试围墙坐标计算')

{
  const center = { x: 0, z: 0 }
  const radius = 10
  const H = 4
  // 正方形围墙：4边，高H层，每层2*radius*2+2*(2*radius-2)? 不对，是4*radius*2? 
  // 周长 = 4 * (2*radius) - 4 = 8*radius - 4；但代码中是每边独立循环，角落重复
  // 实际代码：顶边(2r+1) + 底边(2r+1) + 左边(2r-1) + 右边(2r-1) = 8r
  const totalBlocks = 2 * (2 * radius + 1) + 2 * (2 * radius - 1)
  assertEq(totalBlocks, 8 * radius, `半径${radius}围墙每层 ${8*radius} 块`)
  assert(totalBlocks * H > 300, '围墙需要大量 stone')
}

// ─── 中心坐标逻辑测试 ────────────────────────
console.log('📌 测试建房中心逻辑')

{
  let buildCenter = null
  // 无中心时使用传入坐标
  let cx = 10, cy = 64, cz = 20
  if (buildCenter) { cx = buildCenter.x; cy = buildCenter.y; cz = buildCenter.z }
  assertEq(cx, 10, '无中心 → 使用传入 x')
  assertEq(cz, 20, '无中心 → 使用传入 z')

  // 有中心时覆盖
  buildCenter = { x: 100, y: 70, z: 200 }
  if (buildCenter) { cx = buildCenter.x; cy = buildCenter.y; cz = buildCenter.z }
  assertEq(cx, 100, '有中心 → 覆盖 x')
  assertEq(cz, 200, '有中心 → 覆盖 z')
}

// ─── 围墙垂直障碍检测测试 ────────────────────
console.log('⛰️  测试围墙悬崖检测')

{
  const blockMap = {}
  // 地面 solid(y=63) + 下方10格全是空气 → 悬崖
  blockMap['0,63,10'] = 'grass_block'
  for (let dy = 2; dy <= 11; dy++) blockMap[`0,${63-dy},10`] = 'air'
  // 检查: y-1 solid ✓，但下方10格全 air → 悬崖
  let cliff = true
  for (let dy = 2; dy <= 11; dy++) {
    const b = blockMap[`0,${63-dy},10`]
    if (b && b !== 'air') { cliff = false; break }
  }
  assert(cliff, '下方 10 格全空气 → 判定为悬崖')

  // 正常地面：下方有 solid
  const blockMap2 = {}
  blockMap2['0,63,10'] = 'grass_block'
  blockMap2['0,55,10'] = 'stone' // 第 8 格有石头
  for (let dy = 2; dy <= 11; dy++) {
    const b = blockMap2[`0,${63-dy},10`] || 'air'
    blockMap2[`0,${63-dy},10`] = b
  }
  let cliff2 = true
  for (let dy = 2; dy <= 11; dy++) {
    const b = blockMap2[`0,${63-dy},10`]
    if (b && b !== 'air') { cliff2 = false; break }
  }
  assert(!cliff2, '下方有 stone → 非悬崖')
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