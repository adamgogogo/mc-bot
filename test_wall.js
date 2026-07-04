// test_wall.js —— 独立围墙建造测试
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')
const fs = require('fs'), path = require('path')
const CENTER_FILE = path.join(__dirname, 'center.json')
const testRadius = parseInt(process.argv[2]) || 3
const sleep = ms => new Promise(r => setTimeout(r, ms))

let buildCenter = null
try { if (fs.existsSync(CENTER_FILE)) buildCenter = JSON.parse(fs.readFileSync(CENTER_FILE, 'utf-8')) } catch (_) {}

const bot = mineflayer.createBot({ host: '192.168.1.5', port: 61850, username: 'CodexBot', version: '1.20.4' })
bot.loadPlugin(pathfinder)

function findItem(b, names) {
  const n = Array.isArray(names) ? names : [names]
  for (const x of n) { const i = b.inventory.items().find(y => y.name === x); if (i) return i }
  return null
}

async function placeBlockAt(b, name, pos) {
  const ex = b.blockAt(pos)
  if (ex && ex.name === name) return true
  if (ex && ex.name !== 'air') {
    if (ex.name.includes('door') || ex.name.includes('bed') || ex.name === 'chest') return false
    if (ex.diggable) try { await b.dig(ex) } catch (_) {}
  }
  const item = findItem(b, [name])
  if (!item) return false
  // 走近目标
  for (let retry = 0; retry < 3; retry++) {
    try {
      await b.equip(item, 'hand')
      const faces = [new Vec3(0,-1,0),new Vec3(-1,0,0),new Vec3(1,0,0),new Vec3(0,0,-1),new Vec3(0,0,1)]
      for (const f of faces) {
        const s = b.blockAt(pos.plus(f))
        if (!s || s.name === 'air') continue
        try {
          await b.placeBlock(s, f.scaled(-1))
          await sleep(50)
          if ((b.blockAt(pos)||{}).name !== 'air') return true
        } catch (_) {}
      }
    } catch (_) {}
    await sleep(200)
  }
  return false
}

function scanGround(b, cx, cy, cz) {
  for (let dy = 10; dy >= -10; dy--) {
    const bl = b.blockAt(new Vec3(cx, cy + dy, cz))
    if (bl && bl.name !== 'air' && bl.name !== 'water' && bl.name !== 'lava') return cy + dy + 1
  }
  return cy
}

function canBuild(b, x, y, z) {
  const below = b.blockAt(new Vec3(x, y - 1, z))
  if (!below || below.name === 'air' || below.name === 'water' || below.name === 'lava') return false
  for (let dy = 2; dy <= 11; dy++) {
    const bl = b.blockAt(new Vec3(x, y - dy, z))
    if (!bl || bl.name === 'air') { if (dy === 11) return false } else break
  }
  return true
}

function findWallRadius(b, cx, cy, cz, maxR) {
  for (let r = 1; r <= maxR; r++) {
    for (const [sx, sz] of [[cx,cz-r],[cx+r,cz],[cx,cz+r],[cx-r,cz],[cx+r,cz-r],[cx+r,cz+r],[cx-r,cz+r],[cx-r,cz-r]]) {
      const sy = scanGround(b, sx, cy, sz)
      if (!canBuild(b, sx, sy, sz)) { console.log(`  r=${r} (${sx},${sz}) sy=${sy} FAIL`); return r - 1 }
    }
  }
  return maxR
}

bot.once('spawn', async () => {
  const mcData = require('minecraft-data')(bot.version)
  bot.pathfinder.setMovements(new Movements(bot, mcData))
  bot.pathfinder.movements.canDig = true
  console.log('✅ 已连接，走到中心...')

  if (!buildCenter) { const p = bot.entity.position.floored(); buildCenter = { x: p.x, y: p.y, z: p.z } }
  try { await bot.pathfinder.goto(new goals.GoalNear(buildCenter.x, buildCenter.y, buildCenter.z, 3)) } catch (_) {}
  await sleep(500)
  console.log(`📍 中心(${buildCenter.x},${buildCenter.y},${buildCenter.z}) r=${testRadius}`)

  const cx = buildCenter.x, cz = buildCenter.z, cy = buildCenter.y, H = 4
  const actualR = findWallRadius(bot, cx, cy, cz, testRadius)
  if (actualR < 2) { console.log('❌ 不合适'); process.exit(1) }
  console.log(`✅ 半径=${actualR}`)

  // 补材料
  const total = 8 * actualR * H
  for (let i = 0; i < Math.ceil(total/64)+2; i++) { bot.chat('/give @a oak_planks 64'); await sleep(200) }
  await sleep(1000)
  let sc = bot.inventory.items().filter(i=>i.name==='oak_planks').reduce((s,i)=>s+i.count,0)
  if (sc < total) { console.log(`⚠ oak_planks不足 ${sc}/${total}，等待手动/give...`); for(let w=0;w<30&&sc<total;w++){await sleep(2000);sc=bot.inventory.items().filter(i=>i.name==='oak_planks').reduce((s,i)=>s+i.count,0)} }
  console.log(`📦 oak_planks: ${sc}/${total}`)

  // 收集围墙坐标（顺时针）
  const wall = []
  for (let x = cx - actualR; x <= cx + actualR; x++) wall.push([x, cz - actualR])
  for (let z = cz - actualR + 1; z <= cz + actualR; z++) wall.push([cx + actualR, z])
  for (let x = cx + actualR - 1; x >= cx - actualR; x--) wall.push([x, cz + actualR])
  for (let z = cz + actualR - 1; z >= cz - actualR + 1; z--) wall.push([cx - actualR, z])

  // 逐层建墙，bot 沿着墙走
  const gm = {}; let ok = 0, fail = 0
  for (let l = 0; l < H; l++) {
    console.log(`🧱 层${l+1}/${H}`)
    for (const [x, z] of wall) {
      const gy = l === 0 ? (gm[`${x},${z}`] = scanGround(bot, x, cy, z)) : gm[`${x},${z}`]
      const target = new Vec3(x, gy + l, z)
      // 走到目标旁边
      try { await bot.pathfinder.goto(new goals.GoalNear(x, gy + l, z, 2)) } catch (_) {}
      await sleep(50)
      if (await placeBlockAt(bot, 'oak_planks', target)) ok++; else { fail++; console.log(`  FAIL (${x},${gy+l},${z})`) }
    }
  }
  console.log(`📊 ${ok}/${ok+fail} placed`)

  // 验证
  let v = 0, m = 0
  for (const [x, z] of wall) {
    if ((bot.blockAt(new Vec3(x, (gm[`${x},${z}`]||cy), z)) || {}).name === 'oak_planks') v++; else m++
  }
  console.log(`✅ 验证: ${v}/${wall.length} 第一层在位`)
  if (m === 0) console.log('🎉 通过!')
  else console.log(`⚠ ${m} 块缺失`)
  process.exit(0)
})

bot.on('kicked', r => { console.log('踢出: '+r); process.exit(1) })
bot.on('error', e => { console.log('错误: '+e.message); process.exit(1) })
