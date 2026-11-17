# 苇月剑决 (Reedmoon Duel)

独立设计的第三人称 3D Boss 战原型：苇泽中央的一片低草小洲，月升之时，割苇人与泽守一对一决斗。
An original third-person 3D boss-fight prototype: one islet of low grass in a reed fen at moonrise,
the Reedcutter against the Fen Warden, two stance breaks to win.

- 场地 Arena：低草空地，外围高苇与系布条的木桩标出边界；一轮低垂的冷月作唯一主光，薄雾、萤火、远山剪影。
  A low pale moon is the single key light (shadows and rim light follow it); soil-and-trampled-grass ground, wind-driven reeds of varied height.
- 角色 Characters：约 7.5 头身的人形剑客，躯干、袖与腿是绑定在骨架上的蒙皮曲面（放样截面按骨骼加权），双腿双臂两段 IK，
  双手合拢握刀，脚步落地不滑；全部由代码生成。
  Humanoid fighters (~7.5 heads): trunk, sleeves and legs are skinned surfaces (lofted cross-sections weighted to the bones)
  on a skeleton driven by two-bone IK, closed two-hand grip, planted feet; all built in code.
- 玩家 Player：斩、蓄力刈斩、架刀、拨锋（及时架刀）、连续拨锋、踏步、踏锁、跳跃、甘露葫芦；生命与重心两条槽。
- Boss 泽守：三连斩、双斩、重劈、不可架挡的突刺（紫焰 + 笛啸预警）；二幕新增五连、虚招接突刺、跃劈，节奏更快。
- 流程 Flow：开场 → 一幕 → 失衡 → 月轮（终结技）→ 二幕 → 失衡 → 月轮 → 胜利；生命耗尽则失败；均可重来。
- 技术 Tech：Three.js `WebGPURenderer`（自动回退 WebGL 2）、TSL 顶点风摆、Vite 单文件构建、Playwright 实机输入测试。
- 素材 Assets：几何、贴图、角色、动画、UI、音效与音乐全部由代码程序化生成，无外部素材文件。

## 按键 Controls

| 操作 Action | 键鼠 Input |
| --- | --- |
| 移动 Move | `W` `A` `S` `D`（相对镜头 camera-relative） |
| 斩 Cut (light attack, 3-hit combo) — 点按 short press | 鼠标左键 LMB / `J`（两者完全等同 identical） |
| 刈斩 Reaping Cut (charged heavy) — 按住蓄力，刀锋闪青光后松开 hold, release after the pale-blue flare | 鼠标左键 LMB / `J` |
| 架刀 Guard (hold) · 拨锋 Glance (press just before a hit) | 鼠标右键 RMB / `K` |
| 踏步 Step (dodge) · 踏锁 Bind-Step (step **forward** into the violet-flare thrust: `W` + `Left Shift`) | `Left Shift`（仅左 Shift，`ShiftLeft`；配合方向键 with a direction） |
| 跳 Jump | `Space` |
| 甘露葫芦 Dew Gourd (healing flask, 3 charges) | `R`（仅战斗中 during the fight only） |
| 月轮 Moonwheel (finisher, when the prompt shows) | `F` / `E`（提示出现时左键也可 LMB also works） |
| 凝视 Fix Gaze (lock-on toggle, on by default) | `Q` / `Tab` / 鼠标中键 MMB |
| 环视 Look (free camera, no pointer lock needed) | 移动鼠标 mouse move / `←` `→` `↑` `↓` |
| 暂停 Pause | `P` / `Esc` |
| 开始 Start · 重来 Retry · 静音 Mute | `Enter` 或点击按钮 · `Enter` 或点击按钮（`R` 在结算界面无效 R does nothing on the result screen）· `M` |

规则摘要 Rules in brief:

- 点按斩键是轻斩（可连三刀）；按住约 0.65 秒后刀锋闪青光并响起两声清音，此后松开即刈斩：对出招中/失衡的泽守伤害高，
  对架刀中的泽守可破架（少量伤害与重心，不会被反击）。蓄力未满就松开只出一记轻斩；一次按键绝不会既出轻斩又出刈斩。蓄力中挨打会被打断。
  A short press is a light cut. Held ~0.65 s the blade flares pale blue with a two-note chime; releasing from then on is a
  Reaping Cut: strong against a Warden that is attacking or Unbalanced, and it beats down a raised guard (chip damage and
  Balance, no riposte). Let go early and you get one ordinary cut; one press never gives both. A hit breaks the charge.
- 跳跃约 0.7 秒、高约 1 米，空中可小幅转向，仍受苇墙边界限制。**跳跃没有无敌时间**：空中不能架刀、拨锋、斩或踏步，
  够得着的攻击照样命中并把你打落。它只用来快速换位。
  A jump lasts ~0.7 s and rises ~1 m with moderate air steering inside the reed boundary. **It grants no invulnerability**:
  airborne you cannot guard, Glance, cut or step, and any blow that reaches you lands and knocks you down. It is for repositioning.
- 甘露葫芦三次，每次回复 38 生命（上限 100）。按下 `R` 后 0.7 秒饮下——这一刻同时扣除一次并回复；在此之前挨打则不消耗也不回复。
  满血或葫芦已空时有提示音与抖动提示，不消耗。重来后恢复三次。
  Three charges, 38 health each (capped at 100). The sip comes 0.7 s after `R`: the charge is spent and the heal applied at
  that one moment; a hit before it costs nothing and heals nothing. Full health or an empty gourd gives a "cannot" cue and
  spends nothing. Retry restores all three.

- 架刀挡下的攻击不掉血，但会填充自己的重心槽，满则破防。Guarded hits fill your own Balance; when it fills you are staggered.
- 在攻击命中前约 0.2 秒内按下架刀即为拨锋：不受伤，并填充 Boss 的重心。连段中每一击都要重新按键。
  A Guard press within ~0.2 s before impact is a Glance: no damage and the boss's Balance fills. Re-press for each hit of a string.
- 紫焰突刺无法架挡：朝 Boss 方向踏步（`W` + 左 Shift）迎上去即踏锁，大幅填充 Boss 重心；也可侧向踏步闪开。
- Boss 重心满 → 失衡，靠近按 `F` 施展月轮。第一次进入二幕，第二次结束战斗。斩击削减 Boss 生命，生命越低重心越难恢复。

## 构建与试玩 Build and play

需要 Node.js 20+。Requires Node.js 20+.

```
npm ci
npm run build            # 生成 dist/play.html（单文件，约 0.9 MB）
npm run install:browsers # 安装测试用 Chromium
npm run test:offline     # 离线实机输入测试 real-input offline suite
npm run test:sim         # 代码级模拟测试 code-level simulation test (no browser)
npm run dev              # 开发服务器 → http://localhost:5173/play.html
npm run shots:compare    # 对比截图 → compare/after-*.png (node tests/compare-shots.mjs <prefix> [--gl] [--extra])
npm run test:online-check  # 发布页检查脚本的本地运行 (node tests/run-online-check.mjs [url] [--webgpu|--swgpu])
node tests/measure-fps.mjs # 帧率测量 frame-rate measurement ([--chrome] [--gpu|--swgpu] [--hash=gl=1])
node tests/offline.mjs --only=controls|win|loss [--gpu]  # 单独运行某一轮；--gpu 用本机 Chrome 走 WebGPU
node tests/compare-shots.mjs after --dir=controls [--extra]  # 本轮对比截图 → compare/controls/
node tests/record-clip.mjs      # 录制 compare/controls/gameplay.webm、ambience.wav 并测量音频 → audio-measure.json
node tests/measure-timing.mjs [--gl]  # 墙钟计时：帧率无关性 → compare/controls/timing-*.json
```

音频 Audio：全部由 WebAudio 实时合成，无录音素材。环境声是开阔苇泽的夜：远处稀疏的细雨、随画面中同一阵风起伏的苇丛风声、
零星落在草叶 / 泥地 / 积水上的雨滴（随机间隔、音色、方位，无循环），战斗提示音响起时环境声自动压低并收窄频带。
All audio is synthesised at runtime (no recordings). The ambience is an open fen at night: a thin distant drizzle, wind in
the reeds driven by the same gust value that bends them on screen, and single drops on grass, mud and standing water at
random spacing, timbre and position (no loop); combat cues duck and band-limit it. `M` mutes, `P`/`Esc` pauses (audio suspends).

画质自动调节：帧率偏低时自动降档（减少苇草数量、关闭阴影贴图、降低渲染分辨率），右下角显示当前档位（如 `WebGL 2 · Q4`）。
Automatic quality scaling: when the measured frame rate is low the game steps down a tier (fewer reeds, no shadow map,
lower render scale); the corner label shows the tier. `compare/` holds the before/after screenshots of the realism pass.

试玩：直接双击 `dist/play.html`（`file://`，无需网络）。
To play: double-click `dist/play.html` (works from `file://` with no network).

### 测试用 URL 参数 Test options (URL hash)

`play.html#seed=7&gain=2&hurt=0.5&q=low&mute=1&gl=1`

| 参数 | 作用 |
| --- | --- |
| `seed=N` | 固定 Boss 出招随机种子 fix the boss move RNG seed |
| `gain=X` | Boss 重心增量倍率 scale Balance gained by the boss |
| `hurt=X` | 玩家所受伤害倍率 scale health damage taken by the player |
| `q=low` | 低画质（少苇、无阴影、像素比 1）low quality for software renderers |
| `mute=1` | 静音启动 start muted |
| `gl=1` | 强制 WebGL 2 后端 force the WebGL 2 backend |
| `auto=0` | 关闭画质自动调节 turn automatic quality scaling off |
| `gallery=player\|boss` | 开发用姿势陈列 dev pose gallery (`gy` 朝向 yaw, `gp` 页 page) |
| `rec=1` | 仅取证用：暴露 `window.__rec` 录制钩子（画面 + 主输出音频 / PCM）evidence only: recording hook for the clip and audio measurements |
| `legacyclamp=1` | 仅测量用：恢复旧的 50 ms 帧间隔钳制，用于前后计时对比 measurement only: the previous frame-delta clamp, for timing A/B |

`window.__game.snap` 是只读状态探针（供测试观察，不可写入）。`window.__game.snap` is a read-only state probe for tests.

## 许可 Licensing

- 项目代码 MIT（见仓库根目录 `LICENSE`）。Project code: MIT (see repository `LICENSE`).
- 运行时唯一的第三方内容是打包进 `play.html` 的 [three.js](https://github.com/mrdoob/three.js)（MIT License，
  Copyright © 2010-2026 three.js authors）；其许可声明以注释形式保留在 `play.html` 中。
  The only third-party runtime content is three.js (MIT), bundled into `play.html` with its notice kept as a comment.
- 没有第三方美术、音频或字体文件；文字使用系统字体。No third-party art, audio or font files; text uses system fonts.

测试结果、已知问题与未验证事项见 [DELIVERY.md](DELIVERY.md)。
