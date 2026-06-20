//mc-bot cat bot.js
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const Vec3 = require('vec3')

const bot = mineflayer.createBot({
  host: '127.0.0.1',
  port: 59811,
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

async function walkTo(x, y, z) {
  await bot.pathfinder.goto(new GoalNear(x, y, z, 2))
}

async function placeBlockAt(blockName, pos) {
  const existing = bot.blockAt(pos)
  if (existing && existing.name !== 'air') return true

  const item = bot.inventory.items().find(i => i.name === blockName)
  if (!item) {
    console.log(`背包里没有 ${blockName}，跳过`)
    return false
  }

  try {
    await walkTo(pos.x, pos.y, pos.z)
  } catch (e) {
    console.log(`走到 ${pos} 失败: ${e.message}`)
  }

  await bot.equip(item, 'hand')

  const faces = [
    new Vec3( 0, -1,  0),
    new Vec3( 0,  1,  0),
    new Vec3(-1,  0,  0),
    new Vec3( 1,  0,  0),
    new Vec3( 0,  0, -1),
    new Vec3( 0,  0,  1),
  ]

  for (const face of faces) {
    const supportPos = pos.plus(face)
    const supportBlock = bot.blockAt(supportPos)
    if (supportBlock && supportBlock.name !== 'air') {
      try {
        await bot.placeBlock(supportBlock, face.scaled(-1))
        await sleep(80)
        return true
      } catch (e) {
        continue
      }
    }
  }

  console.log(`放置 ${blockName} @ ${pos} 失败：找不到合适支撑面`)
  return false
}

// ─────────────────────────────────────────────
//  建房主逻辑
// ─────────────────────────────────────────────

async function buildHouse(origin) {
  const W = 7
  const D = 7

  say('🏗 开始建房，请稍候……')

  // ── 1. 地板 ──────────────────────────────
  say('第一步：铺地板……')
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      await placeBlockAt('oak_planks', origin.offset(x, 0, z))
    }
  }
  say('地板完成 ✓')

  // ── 2. 四面墙（y = 1 ~ 3）────────────────
  say('第二步：砌墙……')
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x < W; x++) {
      const isDoor = (x === 3 && (y === 1 || y === 2))
      if (!isDoor) {
        await placeBlockAt('oak_planks', origin.offset(x, y, 0))
      }
    }
    for (let x = 0; x < W; x++) {
      await placeBlockAt('oak_planks', origin.offset(x, y, D - 1))
    }
    for (let z = 1; z < D - 1; z++) {
      await placeBlockAt('oak_planks', origin.offset(0, y, z))
    }
    for (let z = 1; z < D - 1; z++) {
      await placeBlockAt('oak_planks', origin.offset(W - 1, y, z))
    }
  }
  say('墙壁完成 ✓')

  // ── 3. 屋顶（y = 4）──────────────────────
  say('第三步：盖屋顶……')
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      await placeBlockAt('oak_planks', origin.offset(x, 4, z))
    }
  }
  say('屋顶完成 ✓')

  // ── 4. 工具箱 chest ──────────────────────
  say('第四步：放工具箱……')
  const chestPos = origin.offset(3, 1, D - 2)
  const chestItem = bot.inventory.items().find(i => i.name === 'chest')
  if (chestItem) {
    await walkTo(chestPos.x, chestPos.y, chestPos.z)
    await bot.equip(chestItem, 'hand')
    const below = bot.blockAt(chestPos.offset(0, -1, 0))
    if (below && below.name !== 'air') {
      try {
        await bot.placeBlock(below, new Vec3(0, 1, 0))
        say('工具箱放好了 ✓')
      } catch (e) {
        say('放工具箱失败: ' + e.message)
      }
    }
  } else {
    say('背包没有 chest，跳过')
  }

  // ── 5. 床 bed ────────────────────────────
  say('第五步：放床……')
  const bedPos = origin.offset(W - 2, 1, 2)
  const bedItem = bot.inventory.items().find(i => i.name.endsWith('_bed'))
  if (bedItem) {
    await walkTo(bedPos.x, bedPos.y, bedPos.z)
    await bot.equip(bedItem, 'hand')
    await bot.look(Math.PI, 0)
    const below = bot.blockAt(bedPos.offset(0, -1, 0))
    if (below && below.name !== 'air') {
      try {
        await bot.placeBlock(below, new Vec3(0, 1, 0))
        say('床放好了 ✓')
      } catch (e) {
        say('放床失败: ' + e.message)
      }
    }
  } else {
    say('背包没有床，跳过')
  }

  say('🏠 房子建好了！')
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
    say('需要材料：oak_planks × 150, chest × 1, 任意颜色床 × 1')

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
})

bot.on('kicked', console.log)
bot.on('error', console.log)
