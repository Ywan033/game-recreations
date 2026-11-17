# 雨巷双刃 (Rainlane Blades)

独立设计的第三人称 3D Boss 战原型：雨夜，酒馆「醉轮居」外院，一名双刀客，一场两阶段对决。
An original third-person 3D boss-fight prototype: one rainy tavern yard, one dual-blade boss, one
two-phase duel from the opening lane to a win or loss screen, with retry.

- 场地：灯笼窄巷入口 → 铁栅落下的湿青石院；低檐木楼与暖色窗光、冷色雨雾；东墙蒸汽管与阀门、
  东北角锅炉、吊链、墙外缓缓转动的齿轮塔剪影。院子中央保持空旷，杂物都在四角。
- 玩家「巷中客」：三段轻击、按住格挡（刚举刀的瞬间可完全弹开）、带无敌帧的侧闪、破绽加伤。
- Boss「铁檐双鸦 · 莫三更」：快速三连斩、带停顿的延迟重斩、远距离突进；每招都有独立的预兆
  （刀尖闪光 + 地面范围提示 + 音效）和可以惩罚的收招。
- 半血进入第二式「炉心沸」：跪地蓄压 → 蒸汽冲击波，刀刃由冷蓝转为炉红；出手更快、收招更短、
  延迟斩的停顿长短不定并可能连劈第二刀，三连斩追加回旋横扫，突进追加回身斩。
- 全部几何体、贴图、角色、动画、UI 与音频均由代码生成，没有任何第三方美术或音频素材。
- 写实向画面（realism pass）：两名角色是约 7.5 头身的蒙皮人形网格（头颈、肩、收腰的躯干、骨盆、
  上臂/前臂/握拳的手、大腿/小腿/脚），分层着装（内袍、外衣或札甲、腰带与垂带、护臂、靴；Boss 另有
  铁笠、面甲、肩甲、背后汽压罐与交叉双刀鞘），兵器握在拳中。腿部用双骨 IK 落在世界空间的脚印上，
  移动时迈步而不滑步；挥砍有蓄势、出手、随势、收招。湿青石（低粗糙度 + 法线 + 灯笼倒影）、哑光木材
  与灰泥、金属三类材质区分明显；灯笼做局部暖光，冷暗的天光与月光托住阴影；雨丝分近/中/远三层。
  The look is grounded rather than stylised: skinned humanoid fighters, layered clothing, planted
  feet, wet-stone reflections, local warm lantern light against a dim cool ambient.

## 操作 Controls

| 动作 Action | 键盘 Keyboard | 鼠标 Mouse |
| --- | --- | --- |
| 移动 Move | `W A S D` / 方向键 Arrow keys | — |
| 三段连击 3-hit light combo | `J` 点按（连按三次 tap up to 3×） | 左键点按 Left button, tap |
| 蓄力重击 Charged heavy | `J` 按住至“蓄满”提示后松开 hold until the "fully charged" cue, release | 左键按住后松开 Left button, hold and release |
| 格挡 Guard（按住 hold） | `K` | 右键 Right button（按住） |
| 侧闪 Sidestep（无敌帧 i-frames） | 左 `Shift`（`ShiftLeft`，仅左侧）/ `L`（配合方向键；不按方向为后撤） | — |
| 跳跃 Jump | `Space`（按住不会连跳 holding does not re-jump） | — |
| 药壶 Healing flask（3 次 charges） | `R`（仅战斗中 during the fight only） | — |
| 视角 Camera | `Q` / `E` | 移动鼠标 Move the mouse（无需指针锁定 works without pointer lock） |
| 锁定开关 Lock-on toggle | `F` / `Tab` | 中键 Middle button |
| 暂停 Pause · 静音 Mute | `P` · `M` | — |
| 开始 / 重试 Start / Retry | `Enter`（结算画面上也可用 `R`；战斗中 `R` 只是药壶 on the result screen `R` also retries; during the fight `R` is only the flask） | 点击按钮 Click the button |

攻击键规则 Attack key: 按下即起手（轻击手感不变）。起手结束前松开 = 一次轻击；仍按住则转入蓄力，
蓄满前松开仍只是那一次轻击，蓄满后松开（或按满 3 秒）= 一次重击。一次按键绝不会同时打出轻击和重击。
受击会打断蓄力与未喝下的药。A press starts the light cut's wind-up at once; released before the
wind-up ends it is one light cut, still held it becomes a charge, and only a full charge turns
that same input into one heavy cut instead. A hit breaks a charge or an unfinished drink.

跳跃 Jump: 没有无敌帧。Boss 的**突进**与二阶段**旋扫**贴地，可以跃过（双脚离地 0.45 m 以上）；
其余招式照样命中空中的你，空中不能格挡或侧闪。No invulnerability: only the boss's lunge and the
phase-two spinning sweep are low enough to jump; everything else still hits, and you cannot guard
or sidestep in the air.

药壶 Flask: 3 次，每次回复 37.5% 生命上限（不超过上限），开饮 0.6 秒后在同一瞬间扣除次数并回血，
之前被打断则不消耗也不回复；满血或空壶时按 `R` 只有提示，不消耗。重试时恢复为 3 次。

锁定时 `W` 始终朝向 Boss，`A`/`D` 绕其周旋，`S` 后撤。走出窄巷踏入院子即开战，铁栅在身后落下。
Boss 收招时脚下亮起金环并显示「破绽 · PUNISH」，此时命中伤害 ×1.8；Boss 架势未乱（待机）时
你的刀会被拨开，只造成 ×0.4 伤害。格挡承受 25% 伤害（重击 40% 并被震退）；举刀后 0.2 秒内挡下则完全弹开。

## 构建与试玩 Build and play

需要 Node.js 20+。在本目录（`games/phantom-blade-zero`）执行：

```
npm ci
npm run build            # 生成单文件 dist/play.html（约 0.97 MB，JS/CSS 全部内联）
npm run install:browsers # 安装 Playwright 的 Chromium
npm run test:offline     # 离线真实输入测试（file://，断网）
npm run test:sim         # 可选：纯逻辑的代码级测试（Node，无浏览器）
npm run shots:after      # 可选：用真实输入截取对比图 compare/after-*.png（需先 build）
npm run shots:controls:after  # 可选：操作/动作/雨声升级的对比图 compare/controls/after-*.png
npm run capture          # 可选：录制 compare/controls/gameplay.webm（带声音）、ambience.wav 与音频电平测量
```

操作/动作/雨声升级的证据在 `compare/controls/`：`before-*.png` / `after-*.png`、`gameplay.webm`（带声音的
实机片段）、`ambience.wav`（雨声环境层）、`frame-*.png`（录制片段时的截图）、`audio-measurements.json`（实测电平）。

对比截图 Before/after：`compare/before-*.png` 是画面升级前的交付版本，`compare/after-*.png` 是当前版本
（同一脚本 `tests/compare-shots.mjs`、同一种子、1280×720、默认画质）。

试玩：直接双击 `dist/play.html`（`file://`，不需要网络或服务器）。优先使用 WebGPU（硬件适配器），
否则自动回退到 WebGL 2。开发时可用 `npm run dev`，然后打开 `/play.html`。

### URL hash 选项（测试 / 调试用，均有文档）

在地址后追加，例如 `play.html#seed=7&bhp=0.45&q=low`：

| 选项 | 作用 |
| --- | --- |
| `seed=N` | 固定随机种子（Boss 出招序列可复现） |
| `bhp=X` | Boss 生命倍率（0.02–20，默认 1 = 640） |
| `php=X` | 玩家生命倍率（0.02–20，默认 1 = 120） |
| `q=low` | 低画质：关闭阴影、减少点光源与雨滴、像素比 1 |
| `gl` | 强制使用 WebGL 2 后端 |
| `mute` | 启动即静音 |
| `nomusic` | 不播放配乐（只留雨声与战斗音效，用于测量环境声） |
| `rec` | 暴露 `window.__rec` 录制钩子：页面内用 MediaRecorder 录下画布与游戏主输出，并可截取混音做电平测量（`npm run capture` 使用；只观察，不注入输入） |

只读状态探针 `window.__game.snapshot()` / `window.__game.events(sinceT)` 供测试读取状态，不能修改游戏。

## 目录

- `play.html` — 页面骨架、HUD 与样式（构建入口）
- `src/sim.js` — 确定性战斗模拟（固定 1/60 秒步长，无渲染依赖）
- `src/main.js` — 渲染器初始化（WebGPU → WebGL 2）、输入、相机、HUD、事件接线
- `src/world.js` — 程序化院落场景、材质与灯光；`src/tex.js` — 程序化贴图与高度图转法线图
- `src/fighter.js` — 蒙皮人形网格的生成（放样 + 骨骼权重）、分层服装、姿态动画、落脚与腿部 IK
- `src/fx.js` — 雨、水花、蒸汽、刀光拖尾、预兆贴花；`src/audio.js` — WebAudio 合成音效与配乐
- `tests/offline.spec.js` — 离线真实输入测试；`tests/sim.test.mjs`、`tests/controls.test.mjs` — 代码级模拟测试
- `tests/capture.mjs` — 真实输入驱动的录制与音频测量脚本（片段、环境声、电平）
- `tests/online-check.cjs` — 发布页面检查（由仓库的 launcher 调用）
- `tests/compare-shots.mjs` — 真实输入的对比截图脚本；`compare/` — 升级前后的对比图（随仓库提交）
- `tools/` — 开发辅助脚本（截图、WebGPU 检查），不属于交付检查

## 许可与素材 Licensing

项目代码为 MIT 许可（见仓库根目录 `LICENSE`）。没有内嵌任何第三方美术、字体或音频素材；
雨声（远处雨幕、石板与水洼上的雨点、檐口滴水、屋檐木瓦上的雨）、脚步、兵刃、药壶等全部声音均由
`src/audio.js` 用 WebAudio 实时合成，没有使用任何录音；
中文字形使用系统自带字体（楷体/宋体回退）。运行时依赖 three.js（MIT，© three.js authors）被打包进
`dist/play.html`，其许可声明注释保留在打包文件中。

测试结果、已知问题与未验证项见 [DELIVERY.md](DELIVERY.md)。
