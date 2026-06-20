// mc-bot/bot.js
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear, GoalBlock } = goals
const Vec3 = require('vec3')
const collectBlock = require('mineflayer-collectblock').plugin
const tool = require('mineflayer-tool').plugin
const craftingUtil = require('mineflayer-crafting-util').plugin
const pvp = require('mineflayer-pvp').plugin

const bot = mineflayer.createBot({
  host: '127.0.0.1',
  port: 65237,
  username: 'CodexBot',
  version: '1.20.4'
})

// 加载所有插件
bot.loadPlugin(pathfinder)
bot.loadPlugin(collectBlock)
bot.loadPlugin(tool)
bot.loadPlugin(craftingUtil)
bot.loadPlugin(pvp)

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
  try {
    await bot.pathfinder.goto(new GoalNear(x, y, z, 1))
  } catch (e) {
    console.log(`走到 ${x},${y},${z} 失败: ${e.message}`)
  }
}

// ─────────────────────────────────────────────
//  背包管理工具
// ─────────────────────────────────────────────

function getFreeSlots() {
  // 计算空闲背包槽位
  const slots = bot.inventory.slots
  let free = 0
  for (let i = 9; i < 36; i++) { // 主背包 9-35
    if (!slots[i] || slots[i].type === -1) {
      free++
    }
  }
  return free
}

function getInventorySpace() {
  // 获取总空闲空间
  return getFreeSlots()
}

async function clearInventory() {
  // 清理背包，只保留必要的物品
  say('🧹 清理背包...')
  
  const keepItems = [
    'oak_planks', 'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
    'chest', 'red_bed', 'blue_bed', 'white_bed', 'green_bed', 'yellow_bed',
    'oak_door', 'spruce_door', 'birch_door',
    'crafting_table', 'stick', 'wooden_pickaxe', 'wooden_axe',
    'stone_pickaxe', 'stone_axe'
  ]
  
  const items = bot.inventory.items()
  for (const item of items) {
    // 不丢弃有用的物品
    if (keepItems.some(name => item.name.includes(name))) {
      continue
    }
    
    // 丢弃其他物品
    try {
      await bot.toss(item.type, null, item.count)
      console.log(`丢弃了 ${item.count} 个 ${item.name}`)
    } catch (e) {
      console.log(`丢弃 ${item.name} 失败: ${e.message}`)
    }
    await sleep(50)
  }
  
  say('✅ 背包清理完成')
}

async function ensureInventorySpace(neededSlots = 10) {
  // 确保有足够的背包空间
  const free = getFreeSlots()
  if (free < neededSlots) {
    say(`背包空间不足 (空闲: ${free}，需要: ${neededSlots})，正在清理...`)
    await clearInventory()
  }
  
  const newFree = getFreeSlots()
  say(`✅ 背包空闲槽位: ${newFree}`)
  return newFree
}

// ─────────────────────────────────────────────
//  改进的自动采集木材
// ─────────────────────────────────────────────

async function collectWood(amount) {
  say(`🌲 开始采集 ${amount} 个木头...`)
  
  // 确保有足够空间
  await ensureInventorySpace(5)
  
  let collected = 0
  let attempts = 0
  const maxAttempts = 100
  
  while (collected < amount && attempts < maxAttempts) {
    attempts++
    
    // 检查背包空间
    if (getFreeSlots() < 2) {
      say('⚠️ 背包空间不足，清理中...')
      await clearInventory()
    }
    
    // 在周围寻找树木
    const pos = bot.entity.position
    let foundTree = null
    let foundTreePos = null
    const range = 50
    
    for (let dy = -10; dy <= 10; dy += 2) {
      for (let dx = -range; dx <= range; dx += 3) {
        for (let dz = -range; dz <= range; dz += 3) {
          const checkPos = pos.offset(dx, dy, dz)
          const block = bot.blockAt(checkPos)
          if (block && (block.name === 'oak_log' || block.name === 'spruce_log' || 
                       block.name === 'birch_log' || block.name === 'jungle_log' ||
                       block.name === 'acacia_log' || block.name === 'dark_oak_log')) {
            foundTree = block
            foundTreePos = checkPos
            break
          }
        }
        if (foundTree) break
      }
      if (foundTree) break
    }
    
    if (!foundTree) {
      if (attempts % 5 === 0) {
        say(`🔍 搜索中... 尝试 ${attempts}/${maxAttempts}`)
      }
      const randomX = pos.x + (Math.random() - 0.5) * 20
      const randomZ = pos.z + (Math.random() - 0.5) * 20
      await walkTo(randomX, pos.y, randomZ)
      await sleep(500)
      continue
    }
    
    try {
      say(`🪓 发现树木在 ${foundTreePos.x}, ${foundTreePos.y}, ${foundTreePos.z}`)
      await walkTo(foundTreePos.x, foundTreePos.y, foundTreePos.z)
      
      const treeBlock = bot.blockAt(foundTreePos)
      if (treeBlock && treeBlock.name.includes('_log')) {
        await bot.collectBlock.collect(treeBlock)
        collected++
        say(`✅ 采集木头 ${collected}/${amount}`)
        await sleep(200)
      }
    } catch (e) {
      console.log('采集木头失败:', e.message)
      await sleep(1000)
    }
  }
  
  if (collected >= amount) {
    say(`✅ 木材采集完成！共采集 ${collected} 个`)
    return true
  } else {
    say(`⚠️ 只采集到 ${collected} 个木头，需要 ${amount} 个`)
    return false
  }
}

// ─────────────────────────────────────────────
//  自动寻找并采集方块
// ─────────────────────────────────────────────

async function findAndCollectBlock(blockName, count = 1) {
  say(`🔍 寻找 ${blockName}...`)
  
  // 确保有空间
  await ensureInventorySpace(3)
  
  let collected = 0
  let attempts = 0
  const maxAttempts = 30
  
  while (collected < count && attempts < maxAttempts) {
    attempts++
    
    const pos = bot.entity.position
    let foundBlock = null
    let foundBlockPos = null
    const range = 40
    
    for (let dy = -5; dy <= 5; dy += 2) {
      for (let dx = -range; dx <= range; dx += 2) {
        for (let dz = -range; dz <= range; dz += 2) {
          const checkPos = pos.offset(dx, dy, dz)
          const block = bot.blockAt(checkPos)
          if (block && block.name === blockName) {
            foundBlock = block
            foundBlockPos = checkPos
            break
          }
        }
        if (foundBlock) break
      }
      if (foundBlock) break
    }
    
    if (!foundBlock) {
      if (attempts % 3 === 0) {
        say(`🔍 还没找到 ${blockName}，继续搜索...`)
      }
      const randomX = pos.x + (Math.random() - 0.5) * 30
      const randomZ = pos.z + (Math.random() - 0.5) * 30
      await walkTo(randomX, pos.y, randomZ)
      await sleep(500)
      continue
    }
    
    try {
      say(`📦 找到 ${blockName} 在 ${foundBlockPos.x}, ${foundBlockPos.y}, ${foundBlockPos.z}`)
      await walkTo(foundBlockPos.x, foundBlockPos.y, foundBlockPos.z)
      
      const block = bot.blockAt(foundBlockPos)
      if (block && block.name === blockName) {
        await bot.collectBlock.collect(block)
        collected++
        say(`✅ 采集到 ${blockName} (${collected}/${count})`)
        await sleep(200)
      }
    } catch (e) {
      console.log(`采集 ${blockName} 失败:`, e.message)
      await sleep(1000)
    }
  }
  
  return collected >= count
}

// ─────────────────────────────────────────────
//  合成功能（改进版）
// ─────────────────────────────────────────────

async function craftPlanks(count) {
  say(`🔨 开始合成 ${count} 个木板...`)
  
  // 确保有空间
  await ensureInventorySpace(5)
  
  try {
    // 检查是否有足够的木头
    const logs = bot.inventory.items().filter(i => i.name.includes('_log'))
    const totalLogs = logs.reduce((sum, item) => sum + item.count, 0)
    const neededLogs = Math.ceil(count / 4)
    
    if (totalLogs < neededLogs) {
      say(`需要 ${neededLogs} 个木头，当前只有 ${totalLogs} 个`)
      return false
    }
    
    // 使用 crafting-util 合成
    const plankData = {
      id: bot.registry.itemsByName.oak_planks.id,
      count: count
    }
    
    // 先尝试在背包合成（2x2网格）
    try {
      await bot.craft(plankData.id, count)
      say(`✅ 成功合成 ${count} 个木板（背包合成）`)
      return true
    } catch (e) {
      // 如果背包合成失败，尝试使用工作台
      say('背包合成失败，尝试使用工作台...')
      
      // 检查是否有工作台
      let workbench = bot.inventory.items().find(i => i.name === 'crafting_table')
      
      // 如果没有工作台，尝试合成一个
      if (!workbench) {
        say('没有工作台，尝试合成...')
        try {
          await bot.craft(bot.registry.itemsByName.crafting_table.id, 1)
          workbench = bot.inventory.items().find(i => i.name === 'crafting_table')
        } catch (e) {
          say('无法合成工作台，请确保有足够的木板')
          return false
        }
      }
      
      // 放置工作台
      if (workbench) {
        await bot.equip(workbench, 'hand')
        const placePos = bot.entity.position.offset(0, 0, 1).floored()
        const below = bot.blockAt(placePos.offset(0, -1, 0))
        if (below && below.name !== 'air') {
          await bot.placeBlock(below, new Vec3(0, 1, 0))
          await sleep(100)
          
          try {
            await bot.craft(plankData.id, count)
            say(`✅ 成功合成 ${count} 个木板（工作台合成）`)
            return true
          } catch (e) {
            say('工作台合成失败: ' + e.message)
            return false
          }
        }
      }
      return false
    }
    
  } catch (e) {
    console.error('合成失败:', e)
    say('合成失败: ' + e.message)
    return false
  }
}

// ─────────────────────────────────────────────
//  准备所有建房材料
// ─────────────────────────────────────────────

async function prepareBuildingMaterials() {
  say('📦 开始准备建房材料...')
  
  // 先清理背包，腾出空间
  await clearInventory()
  
  // 1. 采集木头
  const woodSuccess = await collectWood(50)
  if (!woodSuccess) {
    say('❌ 木材采集失败，无法继续')
    return false
  }
  
  // 2. 合成木板
  const plankSuccess = await craftPlanks(150)
  if (!plankSuccess) {
    say('❌ 木板合成失败，无法继续')
    return false
  }
  
  // 3. 寻找箱子
  let chestCount = bot.inventory.items().filter(i => i.name === 'chest').length
  if (chestCount === 0) {
    say('🔍 寻找箱子...')
    const found = await findAndCollectBlock('chest', 1)
    if (!found) {
      say('⚠️ 没有找到箱子，使用 /give 命令给我一个')
      say('提示: /give CodexBot chest 1')
    }
  }
  
  // 4. 寻找床
  let bedCount = bot.inventory.items().filter(i => i.name.includes('_bed')).length
  if (bedCount === 0) {
    say('🔍 寻找床...')
    const bedTypes = ['red_bed', 'blue_bed', 'white_bed', 'green_bed', 'yellow_bed']
    let found = false
    for (const bedType of bedTypes) {
      if (await findAndCollectBlock(bedType, 1)) {
        found = true
        break
      }
    }
    if (!found) {
      say('⚠️ 没有找到床，使用 /give 命令给我一个')
      say('提示: /give CodexBot red_bed 1')
    }
  }
  
  // 5. 寻找门
  let doorCount = bot.inventory.items().filter(i => i.name.includes('_door')).length
  if (doorCount === 0) {
    say('🔍 寻找门...')
    const doorTypes = ['oak_door', 'spruce_door', 'birch_door']
    let found = false
    for (const doorType of doorTypes) {
      if (await findAndCollectBlock(doorType, 1)) {
        found = true
        break
      }
    }
    if (!found) {
      say('⚠️ 没有找到门，使用 /give 命令给我一个')
      say('提示: /give CodexBot oak_door 1')
    }
  }
  
  // 显示最终库存
  showInventory()
  
  return true
}

// ─────────────────────────────────────────────
//  显示库存
// ─────────────────────────────────────────────

function showInventory() {
  const summary = {}
  bot.inventory.items().forEach(item => {
    summary[item.name] = (summary[item.name] || 0) + item.count
  })
  const text = Object.entries(summary)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ')
  say(`📦 当前库存: ${text}`)
  say(`📊 空闲槽位: ${getFreeSlots()}/27`)
}

// ─────────────────────────────────────────────
//  监听物品事件
// ─────────────────────────────────────────────

// 当收到物品时，自动整理
bot.on('windowOpen', (window) => {
  // 如果是玩家给予物品的窗口
  if (window.type === 'minecraft:container' || window.type === 'minecraft:generic_3x3') {
    console.log('窗口打开，等待接收物品...')
  }
})

// 当物品被添加到背包时
bot.on('inventoryUpdate', () => {
  // 检查是否收到新的物品
  const free = getFreeSlots()
  console.log(`背包更新，空闲槽位: ${free}`)
})

// ─────────────────────────────────────────────
//  接收物品命令（优化版）
// ─────────────────────────────────────────────

// 响应 /give 命令 - 不会丢弃物品
bot.on('chat', async (username, message) => {
  if (username === bot.username) return
  
  // 如果是 OP 给了物品
  if (message.includes('gave') && message.includes('to') && message.includes(bot.username)) {
    say('📦 收到物品！')
    await sleep(500)
    showInventory()
    return
  }
})

// ─────────────────────────────────────────────
//  放置方块（改进版）
// ─────────────────────────────────────────────

async function placeBlockAt(blockName, pos) {
  const existing = bot.blockAt(pos)
  if (existing && existing.name !== 'air') {
    return true
  }

  // 检查支撑
  const supportPos = pos.offset(0, -1, 0)
  const supportBlock = bot.blockAt(supportPos)
  if (!supportBlock || supportBlock.name === 'air') {
    const faces = [
      new Vec3(0, 0, -1),
      new Vec3(0, 0, 1),
      new Vec3(-1, 0, 0),
      new Vec3(1, 0, 0)
    ]
    
    let foundSupport = false
    let supportBlock2 = null
    for (const face of faces) {
      const checkPos = pos.plus(face)
      const block = bot.blockAt(checkPos)
      if (block && block.name !== 'air') {
        foundSupport = true
        supportBlock2 = block
        break
      }
    }
    
    if (!foundSupport) {
      console.log(`位置 ${pos} 没有支撑`)
      return false
    }
    
    const item = bot.inventory.items().find(i => i.name === blockName)
    if (!item) return false
    
    try {
      await walkTo(pos.x, pos.y, pos.z)
      await bot.equip(item, 'hand')
      const dir = pos.minus(supportBlock2.position)
      await bot.placeBlock(supportBlock2, dir)
      await sleep(100)
      return bot.blockAt(pos) && bot.blockAt(pos).name !== 'air'
    } catch (e) {
      return false
    }
  }

  const item = bot.inventory.items().find(i => i.name === blockName)
  if (!item) {
    console.log(`背包里没有 ${blockName}`)
    return false
  }

  try {
    await walkTo(pos.x, pos.y, pos.z)
    await bot.equip(item, 'hand')
    await bot.placeBlock(supportBlock, new Vec3(0, 1, 0))
    await sleep(100)
    return bot.blockAt(pos) && bot.blockAt(pos).name !== 'air'
  } catch (e) {
    console.log(`放置 ${blockName} 异常: ${e.message}`)
    return false
  }
}

// ─────────────────────────────────────────────
//  建房主逻辑
// ─────────────────────────────────────────────

async function buildHouse(origin) {
  const W = 7
  const D = 7

  say('🏗 开始建房流程...')
  
  // 准备所有材料
  const ready = await prepareBuildingMaterials()
  if (!ready) {
    say('❌ 材料准备失败，建房终止')
    return
  }

  say('🏗 开始建房，请稍候……')

  // ── 1. 地板 ──────────────────────────────
  say('第一步：铺地板...')
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      const pos = origin.offset(x, 0, z)
      await placeBlockAt('oak_planks', pos)
      await sleep(50)
    }
  }
  say('地板完成 ✓')

  // ── 2. 四面墙（y = 1 ~ 3）────────────────
  say('第二步：砌墙...')
  for (let y = 1; y <= 3; y++) {
    // 前墙（z = 0）- 留门位置
    for (let x = 0; x < W; x++) {
      const isDoorSpace = (x === 3 && (y === 1 || y === 2))
      if (!isDoorSpace) {
        const pos = origin.offset(x, y, 0)
        await placeBlockAt('oak_planks', pos)
        await sleep(50)
      }
    }
    
    // 后墙（z = D-1）
    for (let x = 0; x < W; x++) {
      const pos = origin.offset(x, y, D - 1)
      await placeBlockAt('oak_planks', pos)
      await sleep(50)
    }
    
    // 左墙（x = 0）
    for (let z = 1; z < D - 1; z++) {
      const pos = origin.offset(0, y, z)
      await placeBlockAt('oak_planks', pos)
      await sleep(50)
    }
    
    // 右墙（x = W-1）
    for (let z = 1; z < D - 1; z++) {
      const pos = origin.offset(W - 1, y, z)
      await placeBlockAt('oak_planks', pos)
      await sleep(50)
    }
  }
  say('墙壁完成 ✓')

  // ── 3. 安装门 ────────────────────────────
  say('安装门...')
  const doorPos = origin.offset(3, 1, 0)
  const doorItem = bot.inventory.items().find(i => i.name.includes('_door'))
  if (doorItem) {
    try {
      await walkTo(doorPos.x, doorPos.y, doorPos.z)
      await bot.equip(doorItem, 'hand')
      const below = bot.blockAt(doorPos.offset(0, -1, 0))
      if (below && below.name !== 'air') {
        await bot.placeBlock(below, new Vec3(0, 1, 0))
        await sleep(100)
        say('门安装完成 ✓')
      }
    } catch (e) {
      say('安装门失败: ' + e.message)
    }
  } else {
    say('背包没有门，跳过')
  }

  // ── 4. 屋顶（y = 4）──────────────────────
  say('第三步：盖屋顶...')
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      const pos = origin.offset(x, 4, z)
      await placeBlockAt('oak_planks', pos)
      await sleep(50)
    }
  }
  say('屋顶完成 ✓')

  // ── 5. 放箱子 ────────────────────────────
  say('第四步：放工具箱...')
  const chestPos = origin.offset(1, 1, 1)
  const chestItem = bot.inventory.items().find(i => i.name === 'chest')
  if (chestItem) {
    try {
      await walkTo(chestPos.x, chestPos.y, chestPos.z)
      await bot.equip(chestItem, 'hand')
      const below = bot.blockAt(chestPos.offset(0, -1, 0))
      if (below && below.name !== 'air') {
        await bot.placeBlock(below, new Vec3(0, 1, 0))
        await sleep(100)
        say('工具箱放好了 ✓')
      }
    } catch (e) {
      say('放工具箱失败: ' + e.message)
    }
  } else {
    say('背包没有 chest，跳过')
  }

  // ── 6. 放床 ──────────────────────────────
  say('第五步：放床...')
  const bedPos = origin.offset(4, 1, 4)
  const bedItem = bot.inventory.items().find(i => i.name.includes('_bed'))
  if (bedItem) {
    try {
      await walkTo(bedPos.x, bedPos.y, bedPos.z)
      await bot.equip(bedItem, 'hand')
      await bot.look(Math.PI / 2, 0)
      const below = bot.blockAt(bedPos.offset(0, -1, 0))
      if (below && below.name !== 'air') {
        await bot.placeBlock(below, new Vec3(0, 1, 0))
        await sleep(100)
        say('床放好了 ✓')
      }
    } catch (e) {
      say('放床失败: ' + e.message)
    }
  } else {
    say('背包没有床，跳过')
  }

  say('🏠 房子建好了！')
  showInventory()
}

// ─────────────────────────────────────────────
//  初始化
// ─────────────────────────────────────────────

bot.once('spawn', () => {
  const mcData = require('minecraft-data')(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = true
  movements.range = 3
  movements.scafoldingBlocks = ['oak_planks', 'dirt', 'stone', 'grass_block']
  bot.pathfinder.setMovements(movements)

  console.log('Bot joined the game')
  console.log(`背包空闲槽位: ${getFreeSlots()}/27`)
  
  say('🤖 机器人已上线！')
  say('输入 "build house" 开始自动建房（会自动寻找材料）')
  say('输入 "build house x y z" 指定位置建房')
  say('输入 "inv" 查看背包')
  say('输入 "clear" 清理背包')
  say('提示: 使用 /give 给我的物品会自动保存，不会丢弃')
})

// ─────────────────────────────────────────────
//  聊天指令
// ─────────────────────────────────────────────

bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  if (message === 'hello') {
    say(`你好，${username}！`)
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

  if (message === 'clear') {
    await clearInventory()
    say('✅ 背包已清理')
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
    
    try {
      await buildHouse(origin)
    } catch (e) {
      say('建房时出错：' + e.message)
      console.error(e)
    }
  }

  if (message === 'inv') {
    showInventory()
  }

  if (message === 'collect wood') {
    await collectWood(30)
  }
  
  if (message === 'craft planks') {
    await craftPlanks(64)
  }
  
  if (message === 'find chest') {
    await findAndCollectBlock('chest', 1)
  }
  
  if (message === 'find bed') {
    const bedTypes = ['red_bed', 'blue_bed', 'white_bed', 'green_bed', 'yellow_bed']
    for (const bedType of bedTypes) {
      if (await findAndCollectBlock(bedType, 1)) {
        break
      }
    }
  }
})

// ─────────────────────────────────────────────
//  错误处理
// ─────────────────────────────────────────────

bot.on('kicked', (reason) => {
  console.log('被踢出:', reason)
})

bot.on('error', (error) => {
  console.error('错误:', error)
})