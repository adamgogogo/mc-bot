//mc-bot cat bot.js
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const Vec3 = require('vec3')

const bot = mineflayer.createBot({
  host: '127.0.0.1',
  port: 65237,
  username: 'CodexBot',
  version: '1.20.4'
})

bot.loadPlugin(pathfinder)

const { exec } = require('child_process')

// ─────────────────────────────────────────────
//  say = chat + speak
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

async function walkNear(x, y, z, range = 3) {
  try {
    await bot.pathfinder.goto(new GoalNear(x, y, z, range))
  } catch (e) {
    console.log(`walkNear 失败 (${x},${y},${z}): ${e.message}`)
  }
}

/**
 * 在 pos 放置 blockName。
 * 重试机制：最多 retries 次，每次重新走近再尝试。
 */
async function placeBlockAt(blockName, pos, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    // 已有非空气方块 → 直接成功
    const existing = bot.blockAt(pos)
    if (existing && existing.name !== 'air') return true

    // 检查背包
    const item = bot.inventory.items().find(i => i.name === blockName)
    if (!item) {
      console.log(`背包里没有 ${blockName}`)
      return false
    }

    // 走到更近的位置（range=2，几乎贴着）
    await walkNear(pos.x, pos.y, pos.z, 2)
    await bot.equip(item, 'hand')
    await sleep(100)

    // 六个方向依次尝试
    const faces = [
      new Vec3( 0, -1,  0),  // 下
      new Vec3( 0,  1,  0),  // 上
      new Vec3(-1,  0,  0),  // 西
      new Vec3( 1,  0,  0),  // 东
      new Vec3( 0,  0, -1),  // 北
      new Vec3( 0,  0,  1),  // 南
    ]

    let placed = false
    for (const face of faces) {
      const supportPos = pos.plus(face)
      const supportBlock = bot.blockAt(supportPos)
      if (!supportBlock || supportBlock.name === 'air') continue

      try {
        await bot.placeBlock(supportBlock, face.scaled(-1))
        await sleep(150)
        // 再确认一次
        const check = bot.blockAt(pos)
        if (check && check.name !== 'air') {
          placed = true
          break
        }
      } catch (_) {
        continue
      }
    }

    if (placed) return true
    console.log(`第 ${attempt} 次放置 ${blockName} @ ${pos} 失败，重试……`)
    await sleep(300)
  }

  console.log(`放弃放置 ${blockName} @ ${pos}`)
  return false
}

/**
 * 用 /setblock 指令强制放置（需要 OP 权限）
 * 作为 placeBlockAt 失败时的后备方案
 */
async function setBlock(blockName, pos) {
  const existing = bot.blockAt(pos)
  if (existing && existing.name !== 'air') return true
  bot.chat(`/setblock ${pos.x} ${pos.y} ${pos.z} ${blockName}`)
  await sleep(200)
  return true
}

/**
 * 先尝试手动放置，失败则用 /setblock 兜底
 */
async function placeOrSet(blockName, pos) {
  const ok = await placeBlockAt(blockName, pos)
  if (!ok) {
    await setBlock(blockName, pos)
  }
}

// ─────────────────────────────────────────────
//  建房
// ─────────────────────────────────────────────

async function buildHouse(origin) {
  const W = 7   // X
  const D = 7   // Z
  const WALL_H = 3  // 墙高（y=1~3）

  say('🏗 开始建房……')

  // ── 0. 用 /fill 清空建筑区域内部（防止有障碍物）─────
  // fill 内部空气（比房子小一圈，高度 1~3）
  bot.chat(`/fill ${origin.x} ${origin.y} ${origin.z} ${origin.x + W - 1} ${origin.y + 4} ${origin.z + D - 1} air`)
  await sleep(500)

  // ── 1. 地板（用 /fill 一次搞定）─────────────────────
  say('铺地板……')
  bot.chat(`/fill ${origin.x} ${origin.y} ${origin.z} ${origin.x + W - 1} ${origin.y} ${origin.z + D - 1} oak_planks`)
  await sleep(500)
  say('地板完成 ✓')

  // ── 2. 四面墙（/fill 每面墙）────────────────────────
  say('砌墙……')

  // 南墙 (z=0)
  bot.chat(`/fill ${origin.x} ${origin.y + 1} ${origin.z} ${origin.x + W - 1} ${origin.y + WALL_H} ${origin.z} oak_planks`)
  await sleep(300)
  // 北墙 (z=D-1)
  bot.chat(`/fill ${origin.x} ${origin.y + 1} ${origin.z + D - 1} ${origin.x + W - 1} ${origin.y + WALL_H} ${origin.z + D - 1} oak_planks`)
  await sleep(300)
  // 西墙 (x=0)
  bot.chat(`/fill ${origin.x} ${origin.y + 1} ${origin.z} ${origin.x} ${origin.y + WALL_H} ${origin.z + D - 1} oak_planks`)
  await sleep(300)
  // 东墙 (x=W-1)
  bot.chat(`/fill ${origin.x + W - 1} ${origin.y + 1} ${origin.z} ${origin.x + W - 1} ${origin.y + WALL_H} ${origin.z + D - 1} oak_planks`)
  await sleep(300)

  say('墙壁完成 ✓')

  // ── 3. 屋顶（/fill）────────────────────────────────
  say('盖屋顶……')
  bot.chat(`/fill ${origin.x} ${origin.y + 4} ${origin.z} ${origin.x + W - 1} ${origin.y + 4} ${origin.z + D - 1} oak_planks`)
  await sleep(500)
  say('屋顶完成 ✓')

  // ── 4. 开门洞（/fill air 挖掉两格）──────────────────
  say('开门洞……')
  // 门洞在南墙中央 x=origin.x+3，y=origin.y+1 和 y+2
  bot.chat(`/fill ${origin.x + 3} ${origin.y + 1} ${origin.z} ${origin.x + 3} ${origin.y + 2} ${origin.z} air`)
  await sleep(300)

  // ── 5. 放门──────────────────────────────────────────
  say('安装门……')
  bot.chat(`/setblock ${origin.x + 3} ${origin.y + 1} ${origin.z} oak_door[facing=north,half=lower]`)
  await sleep(300)
  bot.chat(`/setblock ${origin.x + 3} ${origin.y + 2} ${origin.z} oak_door[facing=north,half=upper]`)
  await sleep(300)
  say('门安装完成 ✓')

  // ── 6. 放工具箱（chest）──────────────────────────────
  say('放工具箱……')
  // 北墙内侧中央
  const chestX = origin.x + 3
  const chestY = origin.y + 1
  const chestZ = origin.z + D - 2
  bot.chat(`/setblock ${chestX} ${chestY} ${chestZ} chest`)
  await sleep(300)
  say('工具箱完成 ✓')

  // ── 7. 放床──────────────────────────────────────────
  say('放床……')
  // 靠东墙内侧，沿 Z 方向放
  const bedX = origin.x + W - 2
  const bedY = origin.y + 1
  const bedZ = origin.z + 2
  // 床脚朝南（facing=south），foot 在 bedZ，head 在 bedZ+1
  bot.chat(`/setblock ${bedX} ${bedY} ${bedZ} red_bed[facing=south,part=foot]`)
  await sleep(200)
  bot.chat(`/setblock ${bedX} ${bedY} ${bedZ + 1} red_bed[facing=south,part=head]`)
  await sleep(300)
  say('床完成 ✓')

  // ── 8. 走进去欣赏一下 ────────────────────────────────
  await sleep(500)
  const insideX = origin.x + 3
  const insideY = origin.y + 1
  const insideZ = origin.z + 3
  await walkNear(insideX, insideY, insideZ, 1)

  say('🏠 房子建好了！欢迎入住！')
}

// ─────────────────────────────────────────────
//  初始化
// ─────────────────────────────────────────────

bot.once('spawn', () => {
  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  bot.pathfinder.setMovements(movements)

  console.log('Bot joined the game')
  say('我来了')
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

  // ── build house ──────────────────────────
  // 用法1: build house          ← 在机器人当前位置
  // 用法2: build house x y z    ← 指定坐标
  if (message === 'build house' || message.startsWith('build house ')) {
    const parts = message.trim().split(/\s+/)
    let origin

    if (parts.length === 5) {
      const x = parseInt(parts[2])
      const y = parseInt(parts[3])
      const z = parseInt(parts[4])
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

    try {
      await buildHouse(origin)
    } catch (e) {
      say('建房时出错：' + e.message)
      console.error(e)
    }
  }

  // ── inv ──────────────────────────────────
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
})

bot.on('kicked', console.log)
bot.on('error', console.log)
