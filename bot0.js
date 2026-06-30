//mc-bot cat bot.js
const fs = require('fs')
const path = require('path')

// ── 日志文件：所有 console 输出同步写入 bot0.log ──
const logFile = path.join(__dirname, 'bot0.log')
const logStream = fs.createWriteStream(logFile, { flags: 'a' })
const _consoleLog = console.log
const _consoleError = console.error
function toLog(args) {
  const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n'
  logStream.write(line)
}
console.log = function (...args) { toLog(args); _consoleLog.apply(console, args) }
console.error = function (...args) { toLog(args); _consoleError.apply(console, args) }
process.on('exit', () => logStream.end())

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const Vec3 = require('vec3')


const bot = mineflayer.createBot({
  host: '192.168.1.5',//'127.0.0.1',
  port: 61777,//65237,
  username: 'CodexBot',
  version: '1.20.4'
})

bot.loadPlugin(pathfinder)

const { exec } = require('child_process')

// ─────────────────────────────────────────────
//  speak + chat 合并封装
// ─────────────────────────────────────────────

function speak(text) {
  exec(`say ${JSON.stringify(text)}`)
}

function say(text) {
  bot.chat(text)
  speak(text)
}

// ─────────────────────────────────────────────
//  工具函数
// ─────────────────────────────────────────────

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 通用物品查找 —— 兼容不同 Minecraft 版本命名（1.12 / 1.20）
function findItem(candidates) {
  const names = Array.isArray(candidates) ? candidates : [candidates]
  // 先精确匹配物品名称
  for (const name of names) {
    const item = bot.inventory.items().find(i => i.name === name)
    if (item) return item
  }
  // 再模糊匹配包含关系（兼容 1.12 的 bed / 1.20 的 red_bed 等）
  for (const name of names) {
    const item = bot.inventory.items().find(i => i.name.includes(name))
    if (item) return item
  }
  return null
}

async function walkTo(x, y, z) {
  // 距离预检：已在范围内则跳过寻路
  const dist = bot.entity.position.distanceTo(new Vec3(x, y, z))
  if (dist < 3.5) return
  await bot.pathfinder.goto(new GoalNear(x, y, z, 3))
}

// 确保手持正确物品 —— 用 bot.heldItem 实时检查，比缓存可靠
async function ensureEquip(item) {
  const held = bot.heldItem
  if (held && held.name === item.name) return
  await bot.equip(item, 'hand')
}

// 带 2 秒超时的 placeBlock，主动截断避免 5 秒等待
function placeBlockRace(supportBlock, faceVec) {
  return Promise.race([
    bot.placeBlock(supportBlock, faceVec),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
  ])
}

async function placeBlockAt(blockName, pos) {
  // ── 1. 检查目标方块（一次性）────────────────
  const existing = bot.blockAt(pos)
  if (existing && existing.name !== 'air') {
    if (existing.name === blockName || existing.name === 'oak_planks' || existing.name === 'planks') {
      return true
    }
    // 保护性方块：门/床/箱子等，绝不误拆
    if (existing.name.includes('door') || existing.name.includes('bed') ||
        existing.name === 'chest' || existing.name === 'crafting_table') {
      return false
    }
    // 流体方块（水、熔岩）：不能挖掘，直接尝试替换
    if (existing.name === 'water' || existing.name === 'lava') {
      // 跳过清除，直接进入放置流程
    } else if (existing.name.includes('snow') && existing.name !== 'snow_block') {
      try { await bot.dig(existing) } catch (_) {}
    } else if (existing.diggable) {
      try {
        await walkTo(pos.x, pos.y, pos.z)
        await bot.dig(existing)
      } catch (e) {
        return false
      }
    } else {
      return false
    }
  }

  // ── 2. 检查背包（一次性）──────────────────
  const item = findItem([blockName])
  if (!item) {
    say(`⚠ 背包没有 ${blockName}，无法继续放置`)
    return false
  }

  // ── 3. 辅助函数：往旁边空地退避 ──────────────
  async function tryDodge(fromPos) {
    const candidates = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
      [2, 0], [-2, 0], [0, 2], [0, -2],
    ]
    for (const [dx, dz] of candidates) {
      const nx = fromPos.x + dx, nz = fromPos.z + dz
      const nBlock = bot.blockAt(new Vec3(nx, fromPos.y, nz))
      const nAbove = bot.blockAt(new Vec3(nx, fromPos.y + 1, nz))
      if ((!nBlock || nBlock.name === 'air') && (!nAbove || nAbove.name === 'air')) {
        try { await walkTo(nx, fromPos.y, nz); return true } catch (_) {}
      }
    }
    return false
  }

  // ── 4. 支撑面列表 ─────────────────────────
  const faces = [
    new Vec3( 0, -1,  0),
    new Vec3(-1,  0,  0),
    new Vec3( 1,  0,  0),
    new Vec3( 0,  0, -1),
    new Vec3( 0,  0,  1),
  ]

  // ── 5. 重试循环：每轮先处理脚下卡位，再尝试放置 ──
  const maxAttempts = 4
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 5a. 脚下卡位：尝试避让，成功则跳过本轮（下一轮 bot 已不在原位）
    const botFoot = bot.entity.position.floored()
    if (pos.x === botFoot.x && pos.y === botFoot.y && pos.z === botFoot.z) {
      const moved = await tryDodge(pos)
      if (moved) {
        await sleep(100)
        continue // 避让成功，下一轮再试
      }
    }

    // 5b. 从第二轮开始：额外等待 + 后退微调
    if (attempt > 0) {
      await sleep(800)
      await tryDodge(pos)
    }

    // 5c. 走近目标并手持物品
    try { await walkTo(pos.x, pos.y, pos.z) } catch (_) {}
    try { await ensureEquip(item) } catch (_) {}

    // 5d. 尝试所有支撑面
    for (const face of faces) {
      const supportPos = pos.plus(face)
      const supportBlock = bot.blockAt(supportPos)
      if (!supportBlock || supportBlock.name === 'air') continue
      try {
        await placeBlockRace(supportBlock, face.scaled(-1))
        const placed = bot.blockAt(pos)
        if (placed && placed.name !== 'air') {
          await sleep(50)
          return true
        }
      } catch (_) { continue }
    }
  }

  // ── 6. 所有轮失败 ─────────────────────────
  say(`⚠ (${pos.x},${pos.y},${pos.z}) 处无法放置 ${blockName}，周围缺少支撑面或视角被遮挡`)
  return false
}

// 在墙壁内侧放置火把（wallPos 墙壁位置，faceVec 朝向内侧方向）
async function placeTorchOnWall(wallPos, faceVec) {
  const torchItem = findItem(['torch'])
  if (!torchItem) return false

  // 检查目标位置是否为空
  const targetPos = wallPos.plus(faceVec)
  const existing = bot.blockAt(targetPos)
  if (existing && existing.name !== 'air') {
    if (existing.name === 'torch') return true // 已有火把
    return false
  }

  try {
    await walkTo(wallPos.x, wallPos.y, wallPos.z)
    await ensureEquip(torchItem)
    const wallBlock = bot.blockAt(wallPos)
    if (!wallBlock || wallBlock.name === 'air') return false
    await placeBlockRace(wallBlock, faceVec)
    await sleep(50)
    const placed = bot.blockAt(targetPos)
    return placed && placed.name === 'torch'
  } catch (e) {
    return false
  }
}

// 专门放置门（门占 y 和 y+1 两格，下半部分在 pos 处）
async function placeDoorAt(pos) {
  const doorItem = findItem(['oak_door', 'wooden_door', 'spruce_door'])
  if (!doorItem) {
    console.log('背包里没有门，跳过放置门')
    return false
  }

  // 检查门位置是否为空
  const lowerBlock = bot.blockAt(pos)
  const upperBlock = bot.blockAt(pos.offset(0, 1, 0))
  if (lowerBlock && lowerBlock.name !== 'air') {
    console.log(`门下半位置 ${pos} 已有方块: ${lowerBlock.name}`)
    return false
  }
  if (upperBlock && upperBlock.name !== 'air') {
    console.log(`门上半位置已被 ${upperBlock.name} 占据`)
    return false
  }

  const belowBlock = bot.blockAt(pos.offset(0, -1, 0))
  if (!belowBlock || belowBlock.name === 'air') {
    console.log('门下方没有支撑方块')
    return false
  }

  try {
    await walkTo(pos.x, pos.y, pos.z)
    await ensureEquip(doorItem)
    await placeBlockRace(belowBlock, new Vec3(0, 1, 0))
    await sleep(50)
    // 验证门是否放置成功
    const placed = bot.blockAt(pos)
    if (placed && placed.name !== 'air') {
      console.log('门安装成功 ✓')
      return true
    }
  } catch (e) {
    console.log('安装门失败: ' + e.message)
  }
  return false
}

// 专门放置床（床占相邻两格，pos 为床头位置）
async function placeBedAt(pos) {
  const bedItem = findItem(['red_bed', 'white_bed', 'blue_bed', 'bed'])
  if (!bedItem) {
    console.log('背包里没有床，跳过放置床')
    return false
  }

  // 检查床位置（和旁边一格）是否为空
  const block1 = bot.blockAt(pos)
  const block2 = bot.blockAt(pos.offset(1, 0, 0))
  const below1 = bot.blockAt(pos.offset(0, -1, 0))
  const below2 = bot.blockAt(pos.offset(1, -1, 0))

  // 已有床则视为成功（前次运行残留）
  if (block1 && block1.name.includes('bed')) {
    console.log('床已存在，跳过放置')
    return true
  }
  if (block1 && block1.name !== 'air') {
    console.log(`床位置 ${pos} 已有方块: ${block1.name}`)
    return false
  }
  if (block2 && block2.name !== 'air') {
    console.log(`床相邻位置已有方块: ${block2.name}`)
    return false
  }
  if (!below1 || below1.name === 'air') {
    console.log('床下方没有支撑方块')
    return false
  }
  if (!below2 || below2.name === 'air') {
    console.log('床相邻位置下方没有支撑方块')
    return false
  }

  try {
    await walkTo(pos.x, pos.y, pos.z)
    await ensureEquip(bedItem)
    // 面朝东（yaw = -π/2），让床沿 +x 方向延伸，使床头在 pos、床尾在 pos+1
    await bot.look(-Math.PI / 2, 0)
    await placeBlockRace(below1, new Vec3(0, 1, 0))
    await sleep(50)
    // 验证
    const placed = bot.blockAt(pos)
    if (placed && placed.name !== 'air') {
      console.log('床放置成功 ✓')
      return true
    }
  } catch (e) {
    console.log('放置床失败: ' + e.message)
  }
  return false
}

// ─────────────────────────────────────────────
//  房屋验证函数 —— 检查建房是否成功
// ─────────────────────────────────────────────

function verifyHouse(origin, W, D) {
  const results = { pass: true, issues: [] }

  // 检查地板
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

  // 检查墙壁（含门洞位置）
  let wallOk = true
  for (let y = 1; y <= 3; y++) {
    // 前墙 z=0
    for (let x = 0; x < W; x++) {
      const isDoorSpace = (x === 3 && (y === 1 || y === 2))
      const block = bot.blockAt(origin.offset(x, y, 0))
      if (!isDoorSpace && (!block || block.name === 'air')) {
        wallOk = false
        results.issues.push(`前墙缺失 @ (${origin.x + x}, ${origin.y + y}, ${origin.z})`)
      }
    }
    // 后墙 z=D-1
    for (let x = 0; x < W; x++) {
      const block = bot.blockAt(origin.offset(x, y, D - 1))
      if (!block || block.name === 'air') {
        wallOk = false
        results.issues.push(`后墙缺失 @ (${origin.x + x}, ${origin.y + y}, ${origin.z + D - 1})`)
      }
    }
    // 左墙 x=0
    for (let z = 1; z < D - 1; z++) {
      const block = bot.blockAt(origin.offset(0, y, z))
      if (!block || block.name === 'air') {
        wallOk = false
        results.issues.push(`左墙缺失 @ (${origin.x}, ${origin.y + y}, ${origin.z + z})`)
      }
    }
    // 右墙 x=W-1
    for (let z = 1; z < D - 1; z++) {
      const block = bot.blockAt(origin.offset(W - 1, y, z))
      if (!block || block.name === 'air') {
        wallOk = false
        results.issues.push(`右墙缺失 @ (${origin.x + W - 1}, ${origin.y + y}, ${origin.z + z})`)
      }
    }
  }
  if (wallOk) results.issues.push('✓ 墙壁完整')

  // 检查门
  const doorBlock = bot.blockAt(origin.offset(3, 1, 0))
  if (!doorBlock || !doorBlock.name.includes('door')) {
    results.issues.push('⚠ 门缺失或未正确放置 @ 门洞位置')
    results.pass = false
  } else {
    results.issues.push('✓ 门已安装')
  }

  // 检查屋顶
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

  // 检查床
  const bedBlock = bot.blockAt(origin.offset(W - 3, 1, 2))
  if (!bedBlock || !bedBlock.name.includes('bed')) {
    results.issues.push('⚠ 床缺失或未正确放置')
    results.pass = false
  } else {
    results.issues.push('✓ 床已放置')
  }

  // 检查箱子
  const chestBlock = bot.blockAt(origin.offset(3, 1, D - 2))
  if (!chestBlock || chestBlock.name !== 'chest') {
    results.issues.push('⚠ 箱子缺失')
    // 箱子不影响整体 pass（可能背包里没有）
  } else {
    results.issues.push('✓ 箱子已放置')
  }

  return results
}

// ─────────────────────────────────────────────
//  建房主逻辑
// ─────────────────────────────────────────────

async function buildHouse(origin) {
  const W = 7
  const D = 7

  say('🏗 开始建房，请稍候……')

  // ── 0. 场地准备：从下往上清除障碍物（生存模式，禁用命令）──────
  say('第零步：清理场地……')
  // 从下往上逐层清除（y=0→4），避免沙子重力坍塌填回已清区域
  for (let y = 0; y <= 4; y++) {
    for (let x = 0; x < W; x++) {
      for (let z = 0; z < D; z++) {
        const pos = origin.offset(x, y, z)
        const block = bot.blockAt(pos)
        if (!block || block.name === 'air') continue
        if (block.name === 'oak_planks' || block.name === 'planks') continue

        const name = block.name
        // 保护性方块：绝不破坏
        if (name === 'bedrock' || name === 'barrier' || name === 'command_block') continue
        if (name.includes('door') || name.includes('bed') || name === 'chest' || name === 'crafting_table') continue

        // 水/熔岩：不能挖掘，留到 placeBlockAt 阶段用方块替换
        if (name === 'water' || name === 'lava') continue

        // 判断是否为可清除方块
        const clearable = (
          name.includes('sand') || name.includes('dirt') || name === 'gravel' ||
          name === 'clay' || name.includes('mud') ||
          name.includes('grass') || name.includes('fern') || name.includes('flower') ||
          name.includes('tulip') || name.includes('orchid') || name.includes('daisy') ||
          name.includes('allium') || name.includes('bluet') || name.includes('mushroom') ||
          name.includes('vine') || name.includes('leaves') || name.includes('snow') ||
          name.includes('coral') || name === 'kelp' || name === 'seagrass' ||
          name === 'sea_pickle' || name === 'bamboo' || name === 'sugar_cane' ||
          name === 'dead_bush' || name === 'torch' || name === 'ladder' ||
          name === 'cobblestone' || name === 'stone' || name.includes('wool') ||
          name === 'wheat' || name === 'beetroots' || name === 'carrots' ||
          name === 'potatoes' || name === 'melon_stem' || name === 'pumpkin_stem'
        )

        if (clearable) {
          try {
            await walkTo(pos.x, pos.y, pos.z)
            await bot.dig(block)
          } catch (e) {
            // 清除失败不中断
          }
        }
      }
    }
  }
  say('场地清理完成 ✓')

  // ── 1. 地板（蛇形铺设 + 多轮重试，填坑洞）──
  say('第一步：铺地板……')
  // 蛇形排列：z 偶数行 x 递增，z 奇数行 x 递减，确保相邻方块先后相邻
  const floorList = []
  for (let z = 0; z < D; z++) {
    if (z % 2 === 0) {
      for (let x = 0; x < W; x++) floorList.push({ x, z })
    } else {
      for (let x = W - 1; x >= 0; x--) floorList.push({ x, z })
    }
  }

  let floorPlaced = 0
  const maxRounds = 4
  for (let round = 0; round < maxRounds; round++) {
    let placedThisRound = 0
    for (const { x, z } of floorList) {
      const pos = origin.offset(x, 0, z)
      const existing = bot.blockAt(pos)
      // 已放置则跳过
      if (existing && existing.name !== 'air') continue
      const ok = await placeBlockAt('oak_planks', pos)
      if (ok) {
        floorPlaced++
        placedThisRound++
      }
    }
    // 全部铺完就退出
    if (floorPlaced >= W * D) break
  }
  say(`地板完成 ✓ (${floorPlaced}/${W * D})`)

  // ── 2. 四面墙（y = 1 ~ 3）────────────────
  say('第二步：砌墙……')
  for (let y = 1; y <= 3; y++) {
    // 顺时针连续建造，bot 不必跳跃，大幅减少寻路
    // 前墙 z=0，x=0→W-1（x=3 门洞处 y=1,2 跳过）
    for (let x = 0; x < W; x++) {
      const isDoor = (x === 3 && (y === 1 || y === 2))
      if (!isDoor) await placeBlockAt('oak_planks', origin.offset(x, y, 0))
    }
    // 右墙 x=W-1，z=1→D-2
    for (let z = 1; z < D - 1; z++) {
      await placeBlockAt('oak_planks', origin.offset(W - 1, y, z))
    }
    // 后墙 z=D-1，x=W-1→0
    for (let x = W - 1; x >= 0; x--) {
      await placeBlockAt('oak_planks', origin.offset(x, y, D - 1))
    }
    // 左墙 x=0，z=D-2→1
    for (let z = D - 2; z >= 1; z--) {
      await placeBlockAt('oak_planks', origin.offset(0, y, z))
    }
  }
  say('墙壁完成 ✓')

  // ── 2.1 补墙洞：多轮扫描 + 每轮前回中央避免脚下卡位 ──────
  {
    const wallPositions = []
    // 收集所有墙壁位置（不含门洞）
    for (let y = 1; y <= 3; y++) {
      for (let x = 0; x < W; x++) {
        if (!(x === 3 && (y === 1 || y === 2))) {
          wallPositions.push({ x, y, z: 0 }) // 前墙
        }
        wallPositions.push({ x, y, z: D - 1 }) // 后墙
      }
      for (let z = 1; z < D - 1; z++) {
        wallPositions.push({ x: 0, y, z }) // 左墙
        wallPositions.push({ x: W - 1, y, z }) // 右墙
      }
    }

    // 房子中央安全点（bot 站这里不会挡任何墙壁位置）
    const centerX = origin.x + Math.floor(W / 2)
    const centerY = origin.y + 1  // 站在地板上
    const centerZ = origin.z + Math.floor(D / 2)

    let totalFixed = 0
    const wallMaxRounds = 4
    for (let round = 0; round < wallMaxRounds; round++) {
      // 每轮开始前退到中央，确保 bot 不站在墙壁位置上
      await walkTo(centerX, centerY, centerZ)
      await sleep(100)

      let holesFixed = 0
      for (const { x, y, z } of wallPositions) {
        const p = origin.offset(x, y, z)
        const b = bot.blockAt(p)
        if (!b || b.name === 'air') {
          const ok = await placeBlockAt('oak_planks', p)
          if (ok) holesFixed++
        }
      }
      totalFixed += holesFixed

      // 检查是否还有洞
      let remaining = 0
      for (const { x, y, z } of wallPositions) {
        const p = origin.offset(x, y, z)
        const b = bot.blockAt(p)
        if (!b || b.name === 'air') remaining++
      }
      if (remaining === 0) break
      if (holesFixed > 0 || round === 0) {
        console.log(`  补墙洞第 ${round + 1} 轮: 修复 ${holesFixed} 处，剩余 ${remaining} 处`)
      }
    }
    if (totalFixed > 0) say(`补墙洞完成，共修复 ${totalFixed} 处`)
  }

  // ── 2.5 安装门 ──────────────────────────
  say('安装门……')
  const doorPos = origin.offset(3, 1, 0)
  const doorOk = await placeDoorAt(doorPos)
  if (doorOk) {
    say('门安装完成 ✓')
  } else {
    say('⚠ 门安装失败，请检查背包是否有门')
  }

  // ── 3. 屋顶（y = 4）── 蛇形顺序 + 多轮重试 ──
  say('第三步：盖屋顶……')
  const roofList = []
  for (let z = 0; z < D; z++) {
    if (z % 2 === 0) {
      for (let x = 0; x < W; x++) roofList.push({ x, z })
    } else {
      for (let x = W - 1; x >= 0; x--) roofList.push({ x, z })
    }
  }
  let roofPlaced = 0
  const roofMaxRounds = 4
  for (let round = 0; round < roofMaxRounds; round++) {
    let placedThisRound = 0
    for (const { x, z } of roofList) {
      const pos = origin.offset(x, 4, z)
      const existing = bot.blockAt(pos)
      // 已放置则跳过
      if (existing && existing.name !== 'air') continue
      const ok = await placeBlockAt('oak_planks', pos)
      if (ok) {
        roofPlaced++
        placedThisRound++
      }
    }
    // 全部铺完就退出
    if (roofPlaced >= W * D) break
  }
  say(`屋顶完成 ✓ (${roofPlaced}/${W * D})`)

  // ── 3.1 最终墙壁复查：屋顶建造可能影响墙壁，最后扫一遍 ──
  {
    const centerX = origin.x + Math.floor(W / 2)
    const centerY = origin.y + 1
    const centerZ = origin.z + Math.floor(D / 2)
    await walkTo(centerX, centerY, centerZ)
    await sleep(100)

    let finalFixes = 0
    for (let y = 1; y <= 3; y++) {
      for (let x = 0; x < W; x++) {
        if (!(x === 3 && (y === 1 || y === 2))) {
          const p = origin.offset(x, y, 0)
          const b = bot.blockAt(p)
          if (!b || b.name === 'air') {
            if (await placeBlockAt('oak_planks', p)) finalFixes++
          }
        }
        const pb = origin.offset(x, y, D - 1)
        const bb = bot.blockAt(pb)
        if (!bb || bb.name === 'air') {
          if (await placeBlockAt('oak_planks', pb)) finalFixes++
        }
      }
      for (let z = 1; z < D - 1; z++) {
        const pl = origin.offset(0, y, z)
        if (!bot.blockAt(pl) || bot.blockAt(pl).name === 'air') {
          if (await placeBlockAt('oak_planks', pl)) finalFixes++
        }
        const pr = origin.offset(W - 1, y, z)
        if (!bot.blockAt(pr) || bot.blockAt(pr).name === 'air') {
          if (await placeBlockAt('oak_planks', pr)) finalFixes++
        }
      }
    }
    if (finalFixes > 0) say(`最终墙壁复查：又修复 ${finalFixes} 处`)
  }

  // ── 4. 工具箱 chest ──────────────────────
  say('第四步：放工具箱……')
  const chestPos = origin.offset(3, 1, D - 2)
  // 已有箱子视为成功
  const existingChest = bot.blockAt(chestPos)
  if (existingChest && existingChest.name === 'chest') {
    say('工具箱已存在 ✓')
  } else {
    const chestItem = findItem(['chest'])
    if (chestItem) {
      await walkTo(chestPos.x, chestPos.y, chestPos.z)
      await ensureEquip(chestItem)
      const below = bot.blockAt(chestPos.offset(0, -1, 0))
      if (below && below.name !== 'air') {
        try {
          await placeBlockRace(below, new Vec3(0, 1, 0))
          say('工具箱放好了 ✓')
        } catch (e) {
          say('放工具箱失败: ' + e.message)
        }
      }
    } else {
      say('背包没有 chest，跳过')
    }
  }

  // ── 5. 床 bed ────────────────────────────
  say('第五步：放床……')
  const bedPos = origin.offset(W - 3, 1, 2)
  const bedOk = await placeBedAt(bedPos)
  if (bedOk) {
    say('床放好了 ✓')
  } else {
    say('⚠ 床放置失败，请检查背包是否有床')
  }

  // ── 6. 验证房屋 ──────────────────────────
  say('🔍 正在验证房屋建造结果……')
  await sleep(100)
  const result = verifyHouse(origin, W, D)
  if (result.pass) {
    say('✅ 房屋验证通过！所有关键结构已就位')
  } else {
    say('⚠ 房屋存在以下问题：')
    result.issues.filter(i => i.startsWith('⚠') || !i.startsWith('✓')).forEach(issue => {
      say(issue)
    })
  }

  // ── 7. 插火把（内外各4个，y=2 高度）──────────
  say('第七步：插火把……')
  const torchPositions = [
    // === 内侧 ===
    { wall: origin.offset(3, 2, 0), face: new Vec3(0, 0, 1) },       // 前墙内侧（门旁）
    { wall: origin.offset(3, 2, D - 1), face: new Vec3(0, 0, -1) },   // 后墙内侧
    { wall: origin.offset(0, 2, 3), face: new Vec3(1, 0, 0) },        // 左墙内侧
    { wall: origin.offset(W - 1, 2, 3), face: new Vec3(-1, 0, 0) },   // 右墙内侧
    // === 外侧 ===
    { wall: origin.offset(3, 2, 0), face: new Vec3(0, 0, -1) },       // 前墙外侧
    { wall: origin.offset(3, 2, D - 1), face: new Vec3(0, 0, 1) },    // 后墙外侧
    { wall: origin.offset(0, 2, 3), face: new Vec3(-1, 0, 0) },       // 左墙外侧
    { wall: origin.offset(W - 1, 2, 3), face: new Vec3(1, 0, 0) },    // 右墙外侧
  ]
  let torchesPlaced = 0
  for (const { wall, face } of torchPositions) {
    if (await placeTorchOnWall(wall, face)) torchesPlaced++
  }
  if (torchesPlaced > 0) {
    say(`火把已插 ${torchesPlaced}/${torchPositions.length} 个`)
  } else {
    say('⚠ 未能插火把，请检查背包是否有火把')
  }

  say('🏠 房子建好了！')
}

// ─────────────────────────────────────────────
//  初始化
// ─────────────────────────────────────────────

bot.once('spawn', () => {
  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = true
  movements.canOpenDoors = true // 允许自动开门，避免被门卡住
  bot.pathfinder.setMovements(movements)

  console.log('Bot joined the game')
  say('我来了')

  // 检查关键材料
  const planks = bot.inventory.items().filter(i => i.name === 'oak_planks' || i.name === 'planks')
  const totalPlanks = planks.reduce((s, i) => s + i.count, 0)
  const hasChest = bot.inventory.items().some(i => i.name === 'chest')
  const hasDoor = bot.inventory.items().some(i => i.name.includes('door'))
  const hasBed = bot.inventory.items().some(i => i.name.includes('bed'))
  const torchCount = bot.inventory.items()
    .filter(i => i.name === 'torch')
    .reduce((s, i) => s + i.count, 0)

  if (totalPlanks < 150) say(`⚠ 木板不足: ${totalPlanks}，需要 ≥ 150`)
  if (!hasChest) say('⚠ 缺少箱子')
  if (!hasDoor) say('⚠ 缺少门')
  if (!hasBed) say('⚠ 缺少床')
  if (torchCount < 10) say(`⚠ 火把不足: ${torchCount}，需要 ≥ 10，请 /give CodexBot torch 10`)
  if (totalPlanks >= 150 && hasChest && hasDoor && hasBed && torchCount >= 10) {
    say('✅ 材料齐备，输入 build house 开始建房')
  } else {
    say('请用 /give CodexBot oak_planks 200 等方式补充材料')
  }
})

// ─────────────────────────────────────────────
//  聊天指令
// ─────────────────────────────────────────────

bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  if (message === 'hello') {
    say(`你好，${username}`)
  }

  if (message.startsWith('say ')) {
    say(message.slice(4))
  }

  if (message === 'where' || message === 'pos') {
    const p = bot.entity.position
    say(`我在 ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`)
  }

  if (message === 'come') {
    const player = bot.players[username]?.entity
    if (!player) {
      say('我看不到你，靠近一点或等我加载到你')
      return
    }
    say('收到，往你那里走')
    bot.pathfinder.setGoal(new GoalNear(
      player.position.x,
      player.position.y,
      player.position.z, 1
    ))
  }

  if (message === 'stop') {
    bot.pathfinder.setGoal(null)
    say('停下了')
  }

  if (message === 'build house' || message.startsWith('build house ')) {
    const parts = message.trim().split(/\s+/)
    let origin

    if (parts.length === 5) {
      const x = parseFloat(parts[2])
      const y = parseFloat(parts[3])
      const z = parseFloat(parts[4])
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        say('坐标格式错误，用法：build house x y z')
        return
      }
      origin = new Vec3(x, y, z)
    } else {
      const p = bot.entity.position.floored()
      origin = new Vec3(p.x, p.y, p.z)
    }

    say(`建房起点: ${origin.x} ${origin.y} ${origin.z}`)
    say('需要材料：oak_planks × 150, chest × 1, 门 × 1, 床 × 1')

    try {
      await buildHouse(origin)
    } catch (e) {
      say('建房时出错：' + e.message)
      console.error(e)
    }
  }

  if (message === 'inv') {
    const summary = {}
    bot.inventory.items().forEach(item => {
      summary[item.name] = (summary[item.name] || 0) + item.count
    })
    const text = Object.entries(summary)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ')
    say(text || '背包是空的')
  }

  // 测试命令：验证最后一次建造的房屋
  if (message === 'test') {
    const p = bot.entity.position.floored()
    const testOrigin = new Vec3(p.x, p.y, p.z)
    say(`🔍 测试：验证脚下房屋 (起点 ${testOrigin.x} ${testOrigin.y} ${testOrigin.z})……`)
    const result = verifyHouse(testOrigin, 7, 7)
    if (result.pass) {
      say('✅ 测试通过！房屋结构完整')
    } else {
      say('❌ 测试未通过，存在问题：')
    }
    result.issues.forEach(issue => say('  ' + issue))
  }
})

bot.on('kicked', console.log)
bot.on('error', console.log)

// 防止 bot 误上床睡觉
bot.on('sleep', async () => {
  console.log('⚠ bot 意外入睡，立刻唤醒')
  try { await bot.wake() } catch (e) {}
})
