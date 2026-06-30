# Init
MC:1.20.4
node -v
v18.18.0

mkdir mc-bot
cd mc-bot

# Packages
npm install mineflayer
npm install mineflayer-pathfinder
npm install mineflayer-collectblock
npm install mineflayer-tool
npm install mineflayer-crafting-util
npm install mineflayer-pvp
npm install vec3
npm install minecraft-data


# Run

安装所有依赖包

启动Minecraft服务器（版本1.20.4）

运行 node bot.js

在游戏中输入命令：

build house - 在当前脚下建房

build house x y z - 在指定位置建房

inv - 查看背包

collect wood - 手动采集木头

craft planks - 手动合成木板

## 

/give CodexBot oak_planks 64
/give CodexBot oak_planks 64
/give CodexBot oak_planks 64
/give CodexBot oak_door 64
/give CodexBot chest 64
/give CodexBot red_bed 64

## codewhale
node -v
v22.19.0
npm install -g codewhale --verbose
codewhale auth set --provider deepseek
Enter API key for deepseek: sk-********
saved API key for deepseek to /Users/****/.codewhale/config.toml and file-based (~/.codewhale/secrets/)