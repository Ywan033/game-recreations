# 苇月剑决 (Reedmoon Duel)

独立设计的第三人称 3D Boss 战原型：苇泽中央的一片低草小洲，月升之时，割苇人与泽守一对一决斗。
An original third-person 3D boss-fight prototype: one islet of low grass in a reed fen at moonrise,
the Reedcutter against the Fen Warden, two stance breaks to win.

- 场地 Arena：低草空地，外围高苇与系布条的木桩标出边界；琥珀色大月、青蓝暮色、薄雾、萤火、远山剪影。
- 玩家 Player：斩、架刀、拨锋（及时架刀）、连续拨锋、踏步、踏锁；生命与重心两条槽。
- Boss 泽守：三连斩、双斩、重劈、不可架挡的突刺（紫焰 + 笛啸预警）；二幕新增五连、虚招接突刺、跃劈，节奏更快。
- 流程 Flow：开场 → 一幕 → 失衡 → 月轮（终结技）→ 二幕 → 失衡 → 月轮 → 胜利；生命耗尽则失败；均可重来。
- 技术 Tech：Three.js `WebGPURenderer`（自动回退 WebGL 2）、TSL 顶点风摆、Vite 单文件构建、Playwright 实机输入测试。
- 素材 Assets：几何、贴图、角色、动画、UI、音效与音乐全部由代码程序化生成，无外部素材文件。

## 按键 Controls

| 操作 Action | 键鼠 Input |
| --- | --- |
| 移动 Move | `W` `A` `S` `D`（相对镜头 camera-relative） |
| 斩 Cut (light attack, 3-hit combo) | 鼠标左键 LMB / `J` |
| 架刀 Guard (hold) · 拨锋 Glance (press just before a hit) | 鼠标右键 RMB / `K` |
| 踏步 Step (dodge) · 踏锁 Bind-Step (step **forward** into the violet-flare thrust) | `Space`（配合方向键 with a direction） |
| 月轮 Moonwheel (finisher, when the prompt shows) | `F` / `E`（提示出现时左键也可 LMB also works） |
| 凝视 Fix Gaze (lock-on toggle, on by default) | `Q` / `Tab` / 鼠标中键 MMB |
| 环视 Look (free camera, no pointer lock needed) | 移动鼠标 mouse move / `←` `→` `↑` `↓` |
| 开始 Start · 重来 Retry · 静音 Mute | `Enter` 或点击按钮 · `R` / `Enter` 或点击按钮 · `M` |

规则摘要 Rules in brief:

- 架刀挡下的攻击不掉血，但会填充自己的重心槽，满则破防。Guarded hits fill your own Balance; when it fills you are staggered.
- 在攻击命中前约 0.2 秒内按下架刀即为拨锋：不受伤，并填充 Boss 的重心。连段中每一击都要重新按键。
  A Guard press within ~0.2 s before impact is a Glance: no damage and the boss's Balance fills. Re-press for each hit of a string.
- 紫焰突刺无法架挡：朝 Boss 方向踏步迎上去即踏锁，大幅填充 Boss 重心；也可侧向踏步闪开。
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
```

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

`window.__game.snap` 是只读状态探针（供测试观察，不可写入）。`window.__game.snap` is a read-only state probe for tests.

## 许可 Licensing

- 项目代码 MIT（见仓库根目录 `LICENSE`）。Project code: MIT (see repository `LICENSE`).
- 运行时唯一的第三方内容是打包进 `play.html` 的 [three.js](https://github.com/mrdoob/three.js)（MIT License，
  Copyright © 2010-2026 three.js authors）；其许可声明以注释形式保留在 `play.html` 中。
  The only third-party runtime content is three.js (MIT), bundled into `play.html` with its notice kept as a comment.
- 没有第三方美术、音频或字体文件；文字使用系统字体。No third-party art, audio or font files; text uses system fonts.

测试结果、已知问题与未验证事项见 [DELIVERY.md](DELIVERY.md)。
