//mc-bot cat bot.js
const fs = require('fs')
const path = require('path')

// ── 日志：同步写入，确保不丢数据 ──
const logFile = path.join(__dirname, 'bot0.log')
// 日志文件超过 10KB 则清空
if (fs.existsSync(logFile) && fs.statSync(logFile).size > 10240) {
  fs.writeFileSync(logFile, '', 'utf-8')
}
const _consoleLog = console.log
const _consoleError = console.error
function toLog(args) {
  const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n'
  try { fs.appendFileSync(logFile, line, 'utf-8') } catch (_) {}
}
console.log = function (...args) { toLog(args); _consoleLog.apply(console, args) }
console.error = function (...args) { toLog(args); _consoleError.apply(console, args) }

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const Vec3 = require('vec3')

// ─────────────────────────────────────────────
//  房屋追踪：持久化 + 碰撞检测 + 随机选址
// ─────────────────────────────────────────────

const HOUSE_W = 7   // 房屋 x 方向宽度
const HOUSE_D = 7   // 房屋 z 方向深度
const HOUSE_GAP = 1 // 房屋之间最小间隙（避免墙壁贴合）
const MAX_HOUSES = 100

// 房屋形状配置：build random 时随机选择
const HOUSE_SHAPES = {
  small:    { name: '小木屋', w: 5, d: 5, wallH: 3, roof: 'flat' },
  standard: { name: '标准房', w: 7, d: 7, wallH: 4, roof: 'flat' },
  long:     { name: '长屋',   w: 9, d: 5, wallH: 4, roof: 'flat' },
  tower:    { name: '塔楼',   w: 5, d: 5, wallH: 8, roof: 'flat' },
  triangle: { name: '三角房', w: 7, d: 7, wallH: 4, roof: 'triangle' },
}
const SHAPE_KEYS = Object.keys(HOUSE_SHAPES)

function shapeConfig(key) {
  return HOUSE_SHAPES[key] || HOUSE_SHAPES.standard
}

function randomShapeKey() {
  return SHAPE_KEYS[Math.floor(Math.random() * SHAPE_KEYS.length)]
}

/**
 * 估算某个形状需要的 oak_planks 数量（含 20% 余量）
 */
function estimatePlanks(shapeKey) {
  const cfg = shapeConfig(shapeKey)
  const W = cfg.w, D = cfg.d, H = cfg.wallH
  let n = W * D  // 地板
  n += (2 * W + 2 * (D - 2)) * H - 2  // 墙壁（扣除门洞）
  if (cfg.roof === 'triangle') {
    const layers = Math.ceil(W / 2)
    for (let i = 0; i < layers; i++) {
      const w = W - 2 * i
      n += w * D + w * 2  // 屋顶 + 山墙
    }
  } else {
    n += W * D  // 平屋顶
  }
  return Math.ceil(n * 1.2)
}


// ── 建房中心（设置后所有房屋围绕中心建造）──
let buildCenter = null // { x, y, z }
const CENTER_FILE = path.join(__dirname, 'center.json')
const CENTER_RADIUS = 200 // 建房范围半径
const WALL_RADIUS = 150  // 围墙默认半径
try {
  if (fs.existsSync(CENTER_FILE)) {
    buildCenter = JSON.parse(fs.readFileSync(CENTER_FILE, 'utf-8'))
    console.log('📌 中心('+buildCenter.x+','+buildCenter.y+','+buildCenter.z+') 墙半径='+(buildCenter.wallRadius||'?'))
  }
} catch (_) { buildCenter = null }

function saveCenter() {
  try {
    if (buildCenter) fs.writeFileSync(CENTER_FILE, JSON.stringify(buildCenter), 'utf-8')
    else if (fs.existsSync(CENTER_FILE)) fs.unlinkSync(CENTER_FILE)
  } catch (_) {}
}

// 已建房屋列表：{ origin: {x,y,z} }
let builtHouses = []

// 从 houses.json 恢复已建房屋记录
const HOUSES_FILE = path.join(__dirname, 'houses.json')
try {
  if (fs.existsSync(HOUSES_FILE)) {
    const raw = fs.readFileSync(HOUSES_FILE, 'utf-8')
    builtHouses = JSON.parse(raw)
    console.log(`📂 从 houses.json 恢复 ${builtHouses.length} 栋已建房屋记录`)
  }
} catch (e) {
  console.log('⚠ 读取 houses.json 失败，从头开始: ' + e.message)
  builtHouses = []
}

function saveHouses() {
  try {
    fs.writeFileSync(HOUSES_FILE, JSON.stringify(builtHouses, null, 2), 'utf-8')
  } catch (e) {
    console.log('⚠ 保存 houses.json 失败: ' + e.message)
  }
}

/**
 * 判断候选 origin 是否与已建房屋重叠（x-z 平面，含间隙）
 * @param {Vec3} candOrigin 候选房屋起点
 * @param {number} w 房屋宽度（默认 HOUSE_W）
 * @param {number} d 房屋深度（默认 HOUSE_D）
 * @param {number} gap 最小间隙（默认 HOUSE_GAP）
 * @returns {boolean} true=重叠，不可建造
 */
function isOverlapping(candOrigin, w = HOUSE_W, d = HOUSE_D, gap = HOUSE_GAP, candH = 5) {
  const candMinX = candOrigin.x, candMaxX = candOrigin.x + w - 1
  const candMinZ = candOrigin.z, candMaxZ = candOrigin.z + d - 1
  const candMinY = candOrigin.y, candMaxY = candOrigin.y + candH - 1

  for (const h of builtHouses) {
    const o = h.origin
    const hMinX = o.x, hMaxX = o.x + w - 1
    const hMinZ = o.z, hMaxZ = o.z + d - 1
    // 根据已建房子的形状计算 y 高度
    const hCfg = shapeConfig(h.shape || 'standard')
    const hH = hCfg.wallH + (hCfg.roof === 'triangle' ? Math.ceil(hCfg.w / 2) : 1)
    const hMinY = o.y, hMaxY = o.y + hH - 1

    const overlapX = (candMinX <= hMaxX + gap) && (candMaxX + gap >= hMinX)
    const overlapZ = (candMinZ <= hMaxZ + gap) && (candMaxZ + gap >= hMinZ)
    const overlapY = (candMinY <= hMaxY + gap) && (candMaxY + gap >= hMinY)
    if (overlapX && overlapZ && overlapY) return true
  }
  return false
}

/**
 * 在中心点附近随机搜索一个可建造位置
 * @param {number} centerX 搜索中心 x
 * @param {number} centerY 搜索中心 y（bot 脚底高度）
 * @param {number} centerZ 搜索中心 z
 * @param {number} radius 搜索半径（默认 150）
 * @param {number} maxAttempts 最大尝试次数（默认 500）
 * @returns {Vec3|null} 找到的 origin 或 null
 */
function findRandomBuildSpot(centerX, centerY, centerZ, w = HOUSE_W, d = HOUSE_D, radius = 150, maxAttempts = 500) {
  // 如果有建房中心，以中心为原点搜索，限制半径
  if (buildCenter) {
    centerX = buildCenter.x
    centerY = buildCenter.y
    centerZ = buildCenter.z
    radius = Math.min(radius, CENTER_RADIUS)
  }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const angle = Math.random() * 2 * Math.PI
    const dist = Math.sqrt(Math.random()) * radius
    const dx = Math.round(Math.cos(angle) * dist)
    const dz = Math.round(Math.sin(angle) * dist)

    const cx = centerX + dx
    const cz = centerZ + dz

    // 向下扫描找地表：从参考高度往下找第一个固体方块，其上作为地板
    let floorY = null
    for (let sy = centerY + 10; sy >= centerY - 20; sy--) {
      const b = bot.blockAt(new Vec3(cx, sy, cz))
      if (!b || b.name === 'air' || b.name === 'water' || b.name === 'lava') continue
      // 找到固体方块 → 地板建在它上面一层
      floorY = sy + 1
      // 确保 floorY 处是空气（不是嵌在山体里）
      const above = bot.blockAt(new Vec3(cx, floorY, cz))
      if (above && above.name !== 'air') continue
      break
    }
    if (floorY == null) continue // 找不到地表

    const cand = new Vec3(cx, floorY, cz)

    // 碰撞检测（含 y 方向：candH=10 覆盖塔楼高度）
    if (isOverlapping(cand, w, d, HOUSE_GAP, 10)) continue

    if (bot.entity && bot.blockAt) {
      // 检查 3×3 网格地面支撑（9个点，覆盖四角+四边中点+中心）
      const groundChecks = []
      for (let gx = 0; gx <= 2; gx++) {
        const sx = gx === 0 ? 0 : gx === 1 ? Math.floor(w / 2) : w - 1
        for (let gz = 0; gz <= 2; gz++) {
          const sz = gz === 0 ? 0 : gz === 1 ? Math.floor(d / 2) : d - 1
          groundChecks.push(cand.offset(sx, -1, sz))
        }
      }
      let solidGround = true
      for (const pos of groundChecks) {
        const block = bot.blockAt(pos)
        if (!block || block.name === 'air') { solidGround = false; break }
      }
      if (!solidGround) continue

      // 坡度检测：3×3 地面采样点 y 坐标高差 > 2 则跳过（避免斜坡）
      let maxSlope = 0
      for (let i = 0; i < groundChecks.length; i++) {
        for (let j = i + 1; j < groundChecks.length; j++) {
          const dy = Math.abs(groundChecks[i].y - groundChecks[j].y)
          if (dy > maxSlope) maxSlope = dy
        }
      }
      if (maxSlope > 2) continue

      // 保护性方块检查
      let blocked = false
      for (let x = 0; x < HOUSE_W && !blocked; x++) {
        for (let z = 0; z < HOUSE_D && !blocked; z++) {
          for (let y = 0; y <= 4; y++) {
            const block = bot.blockAt(cand.offset(x, y, z))
            if (block && block.name === 'bedrock') {
              blocked = true
              break
            }
          }
        }
      }
      if (blocked) continue

      // 水下检查
      let isUnderwater = false
      for (let x = 0; x < HOUSE_W && !isUnderwater; x++) {
        for (let z = 0; z < HOUSE_D && !isUnderwater; z++) {
          const b = bot.blockAt(cand.offset(x, 5, z))
          if (b && b.name === 'water') isUnderwater = true
        }
      }
      if (isUnderwater) continue

      // 嵌山检测：房子四侧外墙紧邻外部不能被自然方块包裹（石头/泥土≥3格高度）
      const naturalBlocks = new Set([oak_planks,'dirt','grass_block','sand','gravel','clay',
        'andesite','diorite','granite','deepslate','tuff','moss_block','podzol','mycelium'])
      const sides = [
        { dx: -1, dz: 0 },  // 左墙外侧
        { dx: HOUSE_W, dz: 0 }, // 右墙外侧
        { dx: 0, dz: -1 },       // 前墙外侧
        { dx: 0, dz: HOUSE_D },  // 后墙外侧
      ]
      let embeddedInHill = false
      for (const { dx, dz } of sides) {
        let naturalCount = 0
        for (let y = 1; y <= 4; y++) {
          const b = bot.blockAt(cand.offset(dx, y, dz))
          if (b && naturalBlocks.has(b.name)) naturalCount++
        }
        if (naturalCount >= 3) { embeddedInHill = true; break }
      }
      if (embeddedInHill) continue
    }

    return cand
  }
  return null
}

// ── 全局状态：材料等待 ──
let materialWaiter = null // { resolve, needed } 当等待用户补充材料时非空

const bot = mineflayer.createBot({
  host: '192.168.1.5',//'127.0.0.1',
  port: 61850,//65237,
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
  const t0 = Date.now()
  try {
    bot.pathfinder.setGoal(null) // 清除上次残留目标
    await sleep(50)
    await Promise.race([
      bot.pathfinder.goto(new GoalNear(x, y, z, 3)),
      new Promise((_, reject) => setTimeout(() => {
        const p = bot.entity.position
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
        console.log(`[${new Date().toISOString()}] walkTo 超时 ${elapsed}s | 位置(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) → 目标(${x},${y},${z}) canDig=${bot.pathfinder.movements.canDig}`)
        bot.pathfinder.setGoal(null)
        // 超时后尝试往身边空地走一步脱困
        const bp = bot.entity.position.floored()
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]) {
          const nb = bot.blockAt(new Vec3(bp.x + dx, bp.y, bp.z + dz))
          const na = bot.blockAt(new Vec3(bp.x + dx, bp.y + 1, bp.z + dz))
          if (nb && nb.name === 'air' && na && na.name === 'air') {
            bot.pathfinder.setGoal(new GoalNear(bp.x + dx, bp.y, bp.z + dz, 1))
            break
          }
        }
        reject(new Error('timeout'))
      }, 3000))
    ])
  } catch (e) {
    // 吞掉所有错误：超时、goal 变更等都静默处理
  }
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
  const tStart = Date.now() // 总超时 15s
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
    if (Date.now() - tStart > 15000) return false // 总超时
    // 5a. 脚下卡位：尝试避让，成功则跳过本轮（下一轮 bot 已不在原位）
    const botFoot = bot.entity.position.floored()
    if (pos.x === botFoot.x && pos.y === botFoot.y && pos.z === botFoot.z) {
      // 不移动，直接在脚下支撑面上放方块（bot 自动被推起）
      const below = bot.blockAt(new Vec3(pos.x, pos.y - 1, pos.z))
      if (below && below.name !== 'air') {
        await ensureEquip(item)
        try { await placeBlockRace(below, new Vec3(0, 1, 0)); console.log("[火把] " + x + "," + (gy+H) + "," + z) } catch (_) {}
        await sleep(100)
      }
      continue
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

function verifyHouse(origin, W, D, shape = 'flat', wallH = 4) {
  const results = { pass: true, issues: [] }
  const roofLayers = shape === 'triangle' ? Math.ceil(W / 2) : 1
  const wallTop = shape === 'triangle' ? 3 + roofLayers : wallH

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
  for (let y = 1; y <= wallTop; y++) {
    // 前墙 z=0
    for (let x = 0; x < W; x++) {
      const isDoorSpace = (x === 3 && y <= 3 && (y === 1 || y === 2))
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
    // 左墙 x=0 —— triangle 形状 y>3 时左墙被屋顶覆盖，不需要独立墙
    if (shape === 'triangle' && y > 3) {
      // skip: 三角屋顶阶段左右墙由屋顶本身构成
    } else {
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
  if (shape === 'triangle') {
    for (let layer = 0; layer < roofLayers; layer++) {
      const y = wallH + layer
      const mx = layer
      for (let x = mx; x <= W - 1 - mx; x++) {
        for (let z = 0; z < D; z++) {
          const block = bot.blockAt(origin.offset(x, y, z))
          if (!block || block.name === 'air') {
            roofOk = false
            results.issues.push(`三角屋顶缺失 @ (${origin.x + x}, ${origin.y + y}, ${origin.z + z})`)
          }
        }
      }
    }
  } else {
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      const block = bot.blockAt(origin.offset(x, wallH, z))
      if (!block || block.name === 'air') {
        roofOk = false
        results.issues.push(`屋顶缺失 @ (${origin.x + x}, ${origin.y + 4}, ${origin.z + z})`)
      }
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
//  材料检查与等待
// ─────────────────────────────────────────────

/**
 * 确保背包有足够建房材料，不足则先 /give 补充，仍不够则暂停等待用户手动补充
 */
async function ensureMaterials(shapeKey = 'standard') {
  const plankCount = estimatePlanks(shapeKey)
  const needed = [
    { name: 'oak_planks', count: plankCount },
    { name: 'chest', count: 1 },
    { name: 'oak_door', count: 1 },
    { name: 'red_bed', count: 1 },
    { name: 'torch', count: 10 },
  ]

  // 先尝试 /give 自动补充
  say('📦 补充材料……')
  for (const { name, count } of needed) {
    bot.chat(`/give ${bot.username} ${name} ${count}`)
    await sleep(150)
  }
  await sleep(600) // 等物品到账

  // 循环检查直到材料到位
  while (true) {
    const missing = []
    for (const { name, count } of needed) {
      const total = bot.inventory.items()
        .filter(i => i.name === name)
        .reduce((s, i) => s + i.count, 0)
      if (total < count) {
        missing.push(`${name}:${total}/${count}`)
      }
    }

    if (missing.length === 0) {
      say('✅ 材料齐备')
      return
    }

    // 材料不足 → 暂停并等待用户补充
    say(`⏸ 缺少材料: ${missing.join(', ')}`)
    say('👉 请用 /give 补充后输入 continue 继续')

    await new Promise(resolve => {
      materialWaiter = { resolve, needed }
    })
    materialWaiter = null
  }
}

// ─────────────────────────────────────────────
//  建房主逻辑
// ─────────────────────────────────────────────

async function buildHouse(origin, shapeKey = 'standard') {
  const cfg = shapeConfig(shapeKey)
  const W = cfg.w, D = cfg.d, wallH = cfg.wallH
  const isTriangle = cfg.roof === 'triangle'
  const roofLayers = isTriangle ? Math.ceil(W / 2) : 1

  say('🏗 开始建房，请稍候……')

  // ── 0. 补充建房材料
  await ensureMaterials(shapeKey)

  // 场地准备扩展到 roofLayers 高度
  const clearHeight = wallH + roofLayers  // y=0..(wallH+roofLayers)
  // （后面的清除循环会用到，直接覆盖原来的 4）

  // ── 1. 场地准备：从下往上清除障碍物（生存模式，禁用命令）──────
  say('第零步：清理场地……')
  // 从下往上逐层清除（y=0→4），避免沙子重力坍塌填回已清区域
  for (let y = 0; y <= clearHeight; y++) {
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
          name === 'cobblestone' || name === 'oak_planks' || name.includes('wool') ||
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

  // 先退到房子外面，避免被地板困住（不可达则原地开始）
  try { await walkTo(origin.x - 2, origin.y, origin.z - 2) } catch (_) {}

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
      try { await walkTo(pos.x + (pos.x > cx ? -1 : pos.x < cx ? 1 : 0), pos.y, pos.z + (pos.z > cz ? -1 : pos.z < cz ? 1 : 0)) } catch (_) {}
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

  // ── 2. 四面墙
  say('第二步：砌墙……')

  const doorX = Math.floor(W / 2)
  for (let y = 1; y <= wallH; y++) {
    // 顺时针连续建造，bot 不必跳跃，大幅减少寻路
    // 前墙 z=0，x=0→W-1（门洞处 y=1,2 跳过）
    for (let x = 0; x < W; x++) {
      const isDoor = (y <= 2 && x === doorX)
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
    for (let y = 1; y <= wallH; y++) {
      for (let x = 0; x < W; x++) {
        if (!(y <= 2 && x === doorX)) {
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

  // ── 3. 屋顶 ──
  if (isTriangle) {
    say('第三步：盖屋顶（三角形）……')
    let totalPlaced = 0

    for (let layer = 0; layer < roofLayers; layer++) {
      const y = wallH + layer
      const marginX = layer
      const marginZ = 0  // z 方向保持完整，仅 x 方向收窄
      const xStart = marginX
      const xEnd = W - 1 - marginX
      const zStart = marginZ
      const zEnd = D - 1 - marginZ

      // 蛇形铺设当前层
      const layerList = []
      for (let z = zStart; z <= zEnd; z++) {
        if (z % 2 === 0)
          for (let x = xStart; x <= xEnd; x++) layerList.push({ x, z })
        else
          for (let x = xEnd; x >= xStart; x--) layerList.push({ x, z })
      }

      for (const { x, z } of layerList) {
        const pos = origin.offset(x, y, z)
        const existing = bot.blockAt(pos)
        if (existing && existing.name !== 'air') continue
        await placeBlockAt('oak_planks', pos)
        totalPlaced++
      }
    }
    say(`屋顶完成 ✓ (${totalPlaced} 块)`)

    // 前后三角山墙：z=0/D-1，从 y=4 往上跟随屋顶收窄
    say('砌三角山墙……')
    for (let layer = 0; layer < roofLayers; layer++) {
      const y = wallH + layer
      const margin = layer
      for (let x = margin; x <= W - 1 - margin; x++) {
        // 前山墙（z=0），门洞只在 y=1,2 留空
        await placeBlockAt('oak_planks', origin.offset(x, y, 0))
        // 后山墙（z=D-1）
        await placeBlockAt('oak_planks', origin.offset(x, y, D - 1))
      }
    }
    say('山墙完成 ✓')
  } else {
    // 平屋顶
    say('第三步：盖屋顶……')
    // （原有平屋顶代码保持不变）
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
      for (const { x, z } of roofList) {
        const pos = origin.offset(x, wallH, z)
        const existing = bot.blockAt(pos)
        if (existing && existing.name !== 'air') continue
        try { await walkTo(pos.x + (pos.x > cx ? -1 : pos.x < cx ? 1 : 0), pos.y, pos.z + (pos.z > cz ? -1 : pos.z < cz ? 1 : 0)) } catch (_) {}
      const ok = await placeBlockAt('oak_planks', pos)
        if (ok) roofPlaced++
      }
      if (roofPlaced >= W * D) break
    }
    say(`屋顶完成 ✓ (${roofPlaced}/${W * D})`)
  }

  // ── 4. 清空屋内 ──
  say('清理房内……')
  for (let y = 1; y < wallH; y++) {
    for (let x = 1; x < W - 1; x++) {
      for (let z = 1; z < D - 1; z++) {
        const pos = origin.offset(x, y, z)
        const block = bot.blockAt(pos)
        if (!block || block.name === 'air') continue
        // 保护建筑方块
        if (block.name === 'oak_planks' || block.name.includes('door') ||
            block.name.includes('bed') || block.name === 'chest' || block.name === 'torch') continue
        try { await walkTo(pos.x, pos.y, pos.z); await bot.dig(block) } catch (_) {}
      }
    }
  }

  // ── 5. 内饰：门 + 箱子 + 床 ──
  // 门口台阶
  await placeBlockAt('oak_planks', origin.offset(doorX, 0, -1))
  // 装门
  say('装门……')
  const doorPos = origin.offset(doorX, 1, 0)
  await placeDoorAt(doorPos)
  // 放箱子
  say('放箱子……')
  const chestPos = origin.offset(3, 1, D - 2)
  if (findItem(['chest'])) {
    await walkTo(chestPos.x, chestPos.y, chestPos.z)
    await ensureEquip(findItem(['chest']))
    const below = bot.blockAt(chestPos.offset(0, -1, 0))
    if (below && below.name !== 'air') {
      try { await placeBlockRace(below, new Vec3(0, 1, 0)); console.log("[火把] " + x + "," + (gy+H) + "," + z) } catch (_) {}
    }
  }
  // 放床
  say('放床……')
  const bedPos = origin.offset(W - 3, 1, 2)
  await placeBedAt(bedPos)
  console.log('[流程] 床完成，进入验证')

  // ── 6. 验证 ──
  say('🔍 验证房屋……')
  await sleep(100)
  console.log('[验证] 开始验证')
  let vResult
  try {
    vResult = verifyHouse(origin, W, D, cfg.roof, wallH)
  } catch (e) {
    console.log('[验证] 异常: ' + e.message)
    vResult = { pass: false, issues: [e.message] }
  }
  console.log('[验证] 完成, pass=' + vResult.pass)
  if (!vResult.pass) {
    vResult.issues.filter(i => !i.startsWith('✓')).forEach(i => say(i))
  }

  // ── 7. 补墙 ──
  say('🔧 补墙中……')
  console.log('[补墙] 开始补墙')
  try {
  for (let y = 1; y <= wallH; y++) {
    for (let x = 0; x < W; x++) {
      if (!(y <= 2 && x === doorX)) await placeBlockAt('oak_planks', origin.offset(x, y, 0))
      await placeBlockAt('oak_planks', origin.offset(x, y, D - 1))
    }
    for (let z = 1; z < D - 1; z++) {
      await placeBlockAt('oak_planks', origin.offset(0, y, z))
      await placeBlockAt('oak_planks', origin.offset(W - 1, y, z))
    }
  }
  // 火把：中央放内侧，门外放外侧
  say('🔥 插火把……')
  console.log('[火把] 开始插火把')
  if (findItem(['torch'])) {
    const midZ = Math.floor(D / 2)
    const tx = doorX > 0 ? doorX - 1 : doorX + 1
    // 内侧
    try { await walkTo(origin.x + Math.floor(W/2), origin.y, origin.z + Math.floor(D/2)) } catch (_) {}
    for (const { wall, face } of [
      { wall: origin.offset(tx, 2, 0), face: new Vec3(0, 0, 1) },
      { wall: origin.offset(doorX, 2, D - 1), face: new Vec3(0, 0, -1) },
      { wall: origin.offset(0, 2, midZ), face: new Vec3(1, 0, 0) },
      { wall: origin.offset(W - 1, 2, midZ), face: new Vec3(-1, 0, 0) },
    ]) { await placeTorchOnWall(wall, face) }
    // 外侧
    try { await walkTo(origin.x + doorX, origin.y, origin.z - 2) } catch (_) {}
    for (const { wall, face } of [
      { wall: origin.offset(tx, 2, 0), face: new Vec3(0, 0, -1) },
      { wall: origin.offset(doorX, 2, D - 1), face: new Vec3(0, 0, 1) },
      { wall: origin.offset(0, 2, midZ), face: new Vec3(-1, 0, 0) },
      { wall: origin.offset(W - 1, 2, midZ), face: new Vec3(1, 0, 0) },
    ]) { await placeTorchOnWall(wall, face) }
  }

  // ── 8. 离开前扫描：补全地板和墙壁 ──
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      const b = bot.blockAt(origin.offset(x, 0, z))
      if (!b || b.name === 'air') await placeBlockAt('oak_planks', origin.offset(x, 0, z))
    }
  }
  for (let y = 1; y <= wallH; y++) {
    for (let x = 0; x < W; x++) {
      if (!(y <= 2 && x === doorX)) {
        const b = bot.blockAt(origin.offset(x, y, 0))
        if (!b || b.name === 'air') await placeBlockAt('oak_planks', origin.offset(x, y, 0))
      }
      const bb = bot.blockAt(origin.offset(x, y, D - 1))
      if (!bb || bb.name === 'air') await placeBlockAt('oak_planks', origin.offset(x, y, D - 1))
    }
    for (let z = 1; z < D - 1; z++) {
      const bl = bot.blockAt(origin.offset(0, y, z))
      if (!bl || bl.name === 'air') await placeBlockAt('oak_planks', origin.offset(0, y, z))
      const br = bot.blockAt(origin.offset(W - 1, y, z))
      if (!br || br.name === 'air') await placeBlockAt('oak_planks', origin.offset(W - 1, y, z))
    }
  }

  // 离开前确认火把：内侧4个位置缺失则补插
  if (findItem(['torch'])) {
    const midZ = Math.floor(D / 2)
    const tx = doorX > 0 ? doorX - 1 : doorX + 1
    for (const { wall, face } of [
      { wall: origin.offset(tx, 2, 0), face: new Vec3(0, 0, 1) },
      { wall: origin.offset(doorX, 2, D - 1), face: new Vec3(0, 0, -1) },
      { wall: origin.offset(0, 2, midZ), face: new Vec3(1, 0, 0) },
      { wall: origin.offset(W - 1, 2, midZ), face: new Vec3(-1, 0, 0) },
    ]) {
      const tp = wall.plus(face)
      const tb = bot.blockAt(tp)
      if (!tb || tb.name !== 'torch') await placeTorchOnWall(wall, face)
    }
  }

  say('🏠 房子建好了！')

  // ── 9. 离开：走门，走不了就破墙补墙 ──
  const inHouse = () => {
    const p = bot.entity.position
    return p.x >= origin.x && p.x < origin.x + W &&
           p.z >= origin.z && p.z < origin.z + D &&
           Math.abs(p.y - origin.y) < wallH + 2
  }
  if (!inHouse()) return
  // 尝试走门
  try { await walkTo(origin.x + doorX, origin.y, origin.z - 2) } catch (_) {}
  if (!inHouse()) return
  // 破墙：找最近墙壁挖 1x2 洞，走出去，补上
  const pp = bot.entity.position.floored()
  let holeX, holeZ
  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const wx = pp.x + dx, wz = pp.z + dz
    if (wx >= origin.x && wx < origin.x + W && wz >= origin.z && wz < origin.z + D) {
      const b = bot.blockAt(new Vec3(wx, origin.y + 1, wz))
      if (b && b.name === 'oak_planks') { holeX = wx; holeZ = wz; break }
    }
  }
  if (holeX == null) {
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const wx = pp.x + dx, wz = pp.z + dz
      if (wx >= origin.x && wx < origin.x + W && wz >= origin.z && wz < origin.z + D) {
        holeX = wx; holeZ = wz; break
      }
    }
  }
  if (holeX != null) {
    const h1 = new Vec3(holeX, origin.y + 1, holeZ)
    const h2 = new Vec3(holeX, origin.y + 2, holeZ)
    // 挖洞
    try { await bot.dig(bot.blockAt(h1)) } catch (_) {}
    try { await bot.dig(bot.blockAt(h2)) } catch (_) {}
    await sleep(200)
    // 从洞走出去（目标：洞外面一格）
    const outX = holeX < origin.x + W/2 ? origin.x - 1 : origin.x + W
    const outZ = holeZ < origin.z + D/2 ? origin.z - 1 : origin.z + D
    try { await walkTo(outX, origin.y, outZ) } catch (_) {}
    // 确认出去了再补洞
    if (!inHouse()) {
      await placeBlockAt('oak_planks', h1)
      await placeBlockAt('oak_planks', h2)
    }
  }
  } catch (e) { console.log('[补墙] 异常: ' + e.message) }
}

// ─────────────────────────────────────────────
//  围墙建造
// ─────────────────────────────────────────────

/**
 * 扫描围墙位置是否可建造：检查地面是否 solid、非水、非洞穴
 */
function canBuildWallAt(x, y, z) {
  const below = bot.blockAt(new Vec3(x, y - 1, z))
  if (!below || below.name === 'air' || below.name === 'water' || below.name === 'lava') {
    console.log(`[围墙] (${x},${y-1},${z}) 地面不可建: ${below ? below.name : 'null'}`)
    return false
  }
  // 垂直障碍检测：下方 10 格全是空气 → 悬崖，跳过
  let cliff = true
  for (let dy = 2; dy <= 11; dy++) {
    const b = bot.blockAt(new Vec3(x, y - dy, z))
    if (b && b.name !== 'air') { cliff = false; break }
  }
  if (cliff) {
    console.log(`[围墙] (${x},${y},${z}) 下方 10 格全空气 → 悬崖`)
    return false
  }
  for (let wy = y; wy <= y + 3; wy++) {
    const b = bot.blockAt(new Vec3(x, wy, z))
    if (b && b.name === 'water') {
      console.log(`[围墙] (${x},${wy},${z}) 上方有水`)
      return false
    }
  }
  return true
}

function findWallRadius(maxR) {
  const cx = buildCenter.x, cz = buildCenter.z
  let y = buildCenter.y
  console.log(`[围墙] 扫描最大半径 ${maxR}，中心(${cx},${buildCenter.y},${cz})`)
  for (let r = 1; r <= maxR; r++) {
    // 对每个边使用该处实际地表高度
    const samples = [
      [cx, cz - r, '前'], [cx + r, cz, '右'], [cx, cz + r, '后'], [cx - r, cz, '左'],
      [cx + r, cz - r, '右前角'], [cx + r, cz + r, '右后角'],
      [cx - r, cz + r, '左后角'], [cx - r, cz - r, '左前角'],
    ]
    for (const [sx, sz, label] of samples) {
      // 用该位置的实际地表高度（扩大扫描 ±10）
      let sy = y
      for (let dy = 10; dy >= -10; dy--) {
        const b = bot.blockAt(new Vec3(sx, y + dy, sz))
        if (b && b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && !b.name.includes('log') && !b.name.includes('leaves')) {
          sy = y + dy + 1
          break
        }
      }
      console.log(`[围墙] r=${r} ${label}(${sx},${sz}) 地表 y=${sy}`)
      if (!canBuildWallAt(sx, sy, sz)) {
        console.log(`[围墙] r=${r} ${label}(${sx},${sz}) 失败，退回 r=${r-1}`)
        return r - 1
      }
    }
  }
  return maxR
}

/**
 * 围绕建房中心建造 stone 围墙（自动适应地形）
 * @param {number} radius 围墙半径（中心到墙的距离）
 */
async function buildWall(radius = WALL_RADIUS) {
  if (!buildCenter) { say('⚠ 请先用 set center 设置建房中心'); return }
  const cx = buildCenter.x, cz = buildCenter.z
  const H = 4
  // 自动适配地形
  const actualR = findWallRadius(radius)
  if (actualR < 2) { say(`⚠ 地形不适合建围墙`); return }
  const r = actualR
  say(`🧱 建围墙：中心(${cx},${cz})，参数半径 ${radius} → 实际 ${r}，高 ${H}`)

  // 补充 stone 材料（分批请求，每次 64，用 cobblestone 兼容）
  const totalBlocks = 8 * r * H
  const batches = Math.ceil(totalBlocks / 64)
  for (let i = 0; i < batches; i++) {
    bot.chat(`/give @a oak_planks 64`) // 分批给足 stone
    await sleep(300)
  }
  await sleep(800)
  const stoneCount = (bot.inventory.items().filter(i => i.name === 'oak_planks' || i.name === 'cobblestone').reduce((s, i) => s + i.count, 0))
  console.log(`[围墙] stone 需求 ${totalBlocks}，背包实际 ${stoneCount}`)

  // 逐层建造：先建一圈 y=0，再一圈 y=1...，每层结束 bot 回到起点
  // 第一层时扫描并记录每个位置的地表高度
  const groundMap = {} // "x,z" → gy
  const key = (x, z) => `${x},${z}`
  const scanGround = (x, z) => {
    let gy = buildCenter.y
    for (let dy = 10; dy >= -10; dy--) {
      const b = bot.blockAt(new Vec3(x, buildCenter.y + dy, z))
      const name = b ? b.name : 'null'
      if (b && b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && !b.name.includes('log') && !b.name.includes('leaves')) {
        gy = buildCenter.y + dy + 1
        break
      }
      if (dy === -10) console.log('[scanGround] (' + x + ',' + z + ') 未找到地面! 中心y=' + buildCenter.y)
    }
    groundMap[key(x, z)] = gy
    return gy
  }
  // 收集围墙所有坐标（顺时针）
  const wallPositions = []
  for (let x = cx - r; x <= cx + r; x++) wallPositions.push([x, cz - r])
  for (let z = cz - r + 1; z <= cz + r; z++) wallPositions.push([cx + r, z])
  for (let x = cx + r - 1; x >= cx - r; x--) wallPositions.push([x, cz + r])
  for (let z = cz + r - 1; z >= cz - r + 1; z--) wallPositions.push([cx - r, z])

  // 逐层建：边走边建，每次只走到相邻位置
  let placed = 0, total = wallPositions.length * H
  for (let layer = 0; layer < H; layer++) {
    say(`围墙第 ${layer + 1}/${H} 层……`)
    for (let i = 0; i < wallPositions.length; i++) {
      const [x, z] = wallPositions[i]
      const gy = layer === 0 ? scanGround(x, z) : groundMap[key(x, z)]
      const pos = new Vec3(x, gy + layer, z)
      // 走到墙内侧（与墙同一高度，但往中心偏一格）
      const sx = pos.x + (pos.x > cx ? -1 : pos.x < cx ? 1 : 0)
      const sz = pos.z + (pos.z > cz ? -1 : pos.z < cz ? 1 : 0)
      try { await walkTo(sx, pos.y, sz) } catch (_) {}
      // 砍树
      for (let dy = 0; dy <= 3; dy++) {
        const b = bot.blockAt(pos.offset(0, dy, 0))
        if (b && b.name !== 'air' && b.name !== 'oak_planks' && b.diggable) {
          try { await bot.dig(b) } catch (_) {}
        }
      }
      if (await placeBlockAt('oak_planks', pos)) placed++
      // 墙顶每 10 格插火把（最后一层时）
      if (layer === H - 1 && i % 10 === 0 && findItem(['torch'])) {
        const tp = new Vec3(x, gy + H, z)
        try { await ensureEquip(findItem(['torch'])); const below = bot.blockAt(tp.offset(0,-1,0)); if (below && below.name !== 'air') await placeBlockRace(below, new Vec3(0,1,0)) } catch (_) {}
      }
    }
  }

  say(`围墙完成 ✓ ${placed}/${total}（实际半径 ${r}）`)
}

// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  围墙修复
// ─────────────────────────────────────────────

async function repairWall(radius = (buildCenter && buildCenter.wallRadius) || WALL_RADIUS) {
  if (!buildCenter) { say('⚠ 无建房中心'); return }
  console.log('[repair] 开始 r=' + (buildCenter.wallRadius || radius))
  const cx = buildCenter.x, cz = buildCenter.z, cy = buildCenter.y
  const r = buildCenter.wallRadius || radius
  const H = 4
  if (r < 2) { say('⚠ 无墙可修'); return }
  // 快速检查：如果几乎没有墙，提示先 build wall
  let wallCount = 0
  for (let x = cx - r; x <= cx + r; x++) {
    const b = bot.blockAt(new Vec3(x, cy, cz - r))
    if (b && b.name === 'oak_planks') wallCount++
  }
  if (wallCount < 3) { console.log('[repair] 墙不存在'); say('⚠ 墙不存在，请先 build wall'); return }
  say('🔧 顺时针走查修复 r=' + r)

  let fixed = 0, tf = 0, idx = 0
  const checkAndFix = async (x, z) => {
    for (let dy = 10; dy >= -10; dy--) {
      const b = bot.blockAt(new Vec3(x, cy + dy, z))
      if (b && b.name !== 'air' && b.name !== 'water' && b.name !== 'oak_planks' && !b.name.includes('log') && !b.name.includes('leaves')) {
        const baseY = cy + dy + 1
        for (let y = 0; y < H; y++) {
          const b2 = bot.blockAt(new Vec3(x, baseY + y, z))
          if (!b2 || b2.name === 'air') {
            const tp=new Vec3(x,baseY+y,z)
            const b3=bot.blockAt(tp)
            if(!b3||b3.name==='air'){
              const below=bot.blockAt(new Vec3(x,baseY+y-1,z))
              if(below&&below.name!=='air'){
                try{await ensureEquip(findItem(['oak_planks']));await placeBlockRace(below,new Vec3(0,1,0));fixed++}catch(_){}
              }
            }
          }
        }
        // 每 10 格查火把
        if (idx % 10 === 0) {
          const tp = new Vec3(x, baseY + H, z)
          const tb = bot.blockAt(tp)
          if ((!tb || tb.name !== 'torch') && findItem(['torch'])) {
            try {
              await ensureEquip(findItem(['torch']))
              const bl = bot.blockAt(tp.offset(0, -1, 0))
              if (bl && bl.name !== 'air') { await placeBlockRace(bl, new Vec3(0, 1, 0)); tf++ }
            } catch (_) {}
          }
        }
        break
      }
    }
  }

  for (let x = cx - r; x <= cx + r; x++) { await checkAndFix(x, cz - r); idx++ }
  console.log('[repair] 顶边完成 ' + idx)
  for (let z = cz - r + 1; z <= cz + r; z++) { await checkAndFix(cx + r, z); idx++ }
  console.log('[repair] 右边完成 ' + idx)
  for (let x = cx + r - 1; x >= cx - r; x--) { await checkAndFix(x, cz + r); idx++ }
  console.log('[repair] 底边完成 ' + idx)
  for (let z = cz + r - 1; z >= cz - r + 1; z--) { await checkAndFix(cx - r, z); idx++ }
  console.log('[repair] 左边完成 ' + idx)

  console.log('围墙修复完成 ✓ ' + fixed + ' 处，火把 ' + tf + ' 个')
}

//  随机批量建房
// ─────────────────────────────────────────────

/**
 * 在 bot 当前位置附近随机建造 count 栋不重叠的房屋
 * @param {number} count 要建造的房屋数量（1~100）
 * @param {number} radius 搜索半径（默认 150）
 * @param {string} shape 房屋形状（'flat' | 'triangle'）
 */
async function buildRandomHouses(count, radius = 150) {
  if (count <= 0) {
    say('数量必须 ≥ 1')
    return
  }
  if (count > MAX_HOUSES) {
    say(`单次最多建造 ${MAX_HOUSES} 栋，已调整为 ${MAX_HOUSES}`)
    count = MAX_HOUSES
  }

  const remaining = MAX_HOUSES - builtHouses.length
  if (remaining <= 0) {
    say(`🚫 已达到上限 ${MAX_HOUSES} 栋房子，无法再建`)
    return
  }
  const actualCount = Math.min(count, remaining)
  if (actualCount < count) {
    say(`⚠ 只剩 ${remaining} 个名额，本次只建 ${remaining} 栋`)
    count = remaining
  }

  const p = bot.entity.position.floored()
  say(`🎲 开始随机建房：目标 ${count} 栋（随机5种形状），半径 ${radius} 格，已建 ${builtHouses.length}/${MAX_HOUSES}`)

  let built = 0
  let failed = 0
  const maxConsecutiveFailures = 30

  for (let i = 0; i < count; i++) {
    const key = randomShapeKey()
    const cfg = shapeConfig(key)
    const spot = findRandomBuildSpot(p.x, p.y, p.z, cfg.w, cfg.d, radius, 500)
    if (!spot) {
      failed++
      say(`⚠ 第 ${i + 1} 栋：找不到合适位置（已连续失败 ${failed} 次）`)
      if (failed >= maxConsecutiveFailures) {
        say(`🛑 连续 ${maxConsecutiveFailures} 次找不到位置，停止搜索`)
        break
      }
      continue
    }

    failed = 0 // 重置连续失败计数
    say(`🏗 第 ${built + 1}/${count} 栋 → ${cfg.name} @ (${spot.x}, ${spot.y}, ${spot.z})`)

    try {
      await buildHouse(spot, key)
      // 建房成功，记录并保存
      builtHouses.push({ origin: { x: spot.x, y: spot.y, z: spot.z }, shape: key })
      saveHouses()
      built++
      say(`✅ 第 ${built} 栋完成！总计 ${builtHouses.length}/${MAX_HOUSES}`)
    } catch (e) {
      say(`❌ 建房失败: ${e.message}`)
      failed++
    }
  }

  if (built > 0) {
    say(`🎉 随机建房完成！本次新建 ${built} 栋，累计 ${builtHouses.length}/${MAX_HOUSES}`)
  } else {
    say('😞 未能建造任何房屋，请尝试调整位置或扩大搜索半径')
  }
}

// ─────────────────────────────────────────────
//  初始化
// ─────────────────────────────────────────────

bot.once('spawn', () => {
  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = true
  movements.canOpenDoors = true
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

  // 报告已建房屋状态
  if (builtHouses.length > 0) {
    say(`📊 已记录 ${builtHouses.length}/${MAX_HOUSES} 栋房屋，输入 build random [数量] 随机建房`)
  } else {
    say('📊 暂无房屋记录，输入 build random [数量] 开始随机建房')
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

  // continue —— 材料补充完毕，继续建房
  if (message === 'continue') {
    if (materialWaiter) {
      // 重新检查材料
      const missing = []
      for (const { name, count } of materialWaiter.needed) {
        const total = bot.inventory.items()
          .filter(i => i.name === name)
          .reduce((s, i) => s + i.count, 0)
        if (total < count) {
          missing.push(`${name}:${total}/${count}`)
        }
      }
      if (missing.length === 0) {
        say('✅ 材料齐了，继续建房！')
        materialWaiter.resolve()
      } else {
        say(`⏸ 材料还不够: ${missing.join(', ')}，请继续补充后输入 continue`)
      }
    } else {
      say('当前没有等待材料补充的任务')
    }
    return
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
    let shape = 'flat'

    // 检测 shape 关键字
    const hasTriangle = parts.includes('triangle')
    if (hasTriangle) shape = 'triangle'

    const coordParts = parts.filter(p => p !== 'build' && p !== 'house' && p !== 'triangle')
    if (coordParts.length === 3) {
      const x = parseFloat(coordParts[0])
      const y = parseFloat(coordParts[1])
      const z = parseFloat(coordParts[2])
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
      await buildHouse(origin, 'standard')
      // 记录到已建列表
      if (!builtHouses.some(h => h.origin.x === origin.x && h.origin.y === origin.y && h.origin.z === origin.z)) {
        builtHouses.push({ origin: { x: origin.x, y: origin.y, z: origin.z }, shape: 'standard' })
        saveHouses()
      }
    } catch (e) {
      say('建房时出错：' + e.message)
      console.error(e)
    }
  }

  // build random [count] —— 在当前位置附近随机建造不重叠的房屋
  if (message === 'build random' || message.startsWith('build random ')) {
    const parts = message.trim().split(/\s+/)
    let count = 1

    for (const p of parts) {
      const n = parseInt(p, 10)
      if (!isNaN(n) && n >= 1) {
        count = n
        break
      }
    }

    try {
      await buildRandomHouses(count)
    } catch (e) {
      say('随机建房时出错：' + e.message)
      console.error(e)
    }
  }

  // set center —— 设置建房中心
  if (message === 'set center') {
    const p = bot.entity.position.floored()
    buildCenter = { x: p.x, y: p.y, z: p.z }
    saveCenter()
    say(`📌 建房中心已设为 (${buildCenter.x}, ${buildCenter.y}, ${buildCenter.z})，半径 ${CENTER_RADIUS} 格`)
  }


  // repair wall [radius] —— 修复围墙缺失方块
  if (message === 'repair wall' || message.startsWith('repair wall ')) {
    if (!buildCenter) { say('⚠ 请先用 set center 设置建房中心'); return }
    const parts = message.trim().split(/\s+/)
    let radius = WALL_RADIUS
    if (parts.length >= 3) { const r = parseInt(parts[2]); if (!isNaN(r) && r > 0) radius = r }
    try { await repairWall(radius) } catch (e) { say('修复出错: ' + e.message) }
  }


  // wall info —— 查看围墙信息
  if (message === 'wall info') {
    if (!buildCenter) { say('⚠ 无建房中心'); return }
    var wr=buildCenter.wallRadius;say('🧱 中心('+buildCenter.x+','+buildCenter.z+') 墙半径='+(wr||'未建'))
  }

  // build wall —— 围绕中心建 stone 围墙
  if (message === 'build wall' || message.startsWith('build wall ')) {
    if (!buildCenter) { say('⚠ 请先用 set center 设置建房中心'); return }
    const parts = message.trim().split(/\s+/)
    let radius = WALL_RADIUS
    if (parts.length >= 3) { const r = parseInt(parts[2]); if (!isNaN(r) && r > 0) radius = r }
    try { await buildWall(radius) } catch (e) { say('建围墙出错: ' + e.message); console.error(e) }
  }

  if (message === 'houses' || message === 'house list') {
    if (builtHouses.length === 0) {
      say('📊 暂无已建房屋记录')
    } else {
      say(`📊 已建房屋 ${builtHouses.length}/${MAX_HOUSES}：`)
      // 最近 10 栋
      const recent = builtHouses.slice(-10)
      for (const h of recent) {
        say(`  (${h.origin.x}, ${h.origin.y}, ${h.origin.z})`)
      }
      if (builtHouses.length > 10) {
        say(`  ... 还有 ${builtHouses.length - 10} 栋`)
      }
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