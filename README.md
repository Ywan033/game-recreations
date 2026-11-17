# game-recreations

独立设计的第三人称 3D Boss 战原型合集。每款是一个场地、一名 Boss、一场可从开场打到胜负结算并可重试的战斗，交付为可双击打开的单文件 HTML。

当前进度见 [PROGRESS.md](PROGRESS.md)。

## 在线试玩

<!-- online-play:start -->
- **雨巷双刃 (Rainlane Blades)**: 待上线
- **苇月剑决 (Reedmoon Duel)**: 待上线
<!-- online-play:end -->

每款通过离线验收后，同一个已验证的 HTML 会发布到 GitHub Pages（`docs/play/`），并在无登录的浏览器中验证实际网址后才在此处给出链接。需要桌面浏览器、键盘和鼠标。

## 游戏与顺序

| 顺序 | 游戏 | 工程 ID / 分支 | 交付文件 |
| --- | --- | --- | --- |
| 1 | 雨巷双刃 (Rainlane Blades) | `phantom-blade-zero` / `game/phantom-blade-zero` | `rainlane-blades.html` |
| 2 | 苇月剑决 (Reedmoon Duel) | `sekiro` / `game/sekiro` | `reedmoon-duel.html` |

工程 ID 仅用于目录和分支定位。两款的场地、角色、Boss、动作、界面和素材均为独立设计。

## 仓库结构

```
CLAUDE.md                  所有游戏共用的交付规则
PROGRESS.md                进度表（由启动器更新）
LICENSE                    MIT
tasks/queue.json           运行队列：顺序、分支、交付文件名、每款预算
tasks/<id>.md              每款的任务说明
scripts/run-games.ps1      无人值守启动器
scripts/simulate.ps1       启动器的本地模拟（不调用模型，不推送）
scripts/progress-labels.json  进度表文案
docs/                      GitHub Pages 站点；docs/play/ 放已验证的单文件 HTML
games/<id>/                游戏源码、README、CLAUDE.md、DELIVERY.md（在各自的 game/<id> 分支）
```

每款游戏在自己的分支和 git worktree 中开发，位于与本仓库同级的 `game-recreations-worktrees/<id>`。缓存、测试临时文件和交付物分别在同级的 `game-recreations-cache/` 和 `game-recreations-deliveries/`，不进入仓库。

## 预检与启动

需要 Windows PowerShell 5.1、Git、Node.js 和已登录的 Claude Code CLI。在仓库根目录执行：

```powershell
# 只读预检：检查工具、队列、工作区、分支和登录状态
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-games.ps1

# 本地模拟：用沙盒仓库和模拟生成器验证队列、提示词传递、失败后继续、
# 重跑跳过已交付项、交付复制、补推和通知回退
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\simulate.ps1

# 正式运行
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-games.ps1 -Run
```

启动器按队列顺序处理每款游戏：

1. 把共用 `CLAUDE.md`、`tasks/<id>.md` 和 `games/<id>/CLAUDE.md` 一并传给生成会话（模型 `claude-fable-5-2`）。
2. 实际执行 `npm ci`、`npm run build`、`npm run install:browsers`、`npm run test:offline` 并核对退出码。
3. 验证失败时带着失败日志续跑修复，累计成本不超过 `queue.json` 中该款的 `budgetUsd`。
4. 通过后把 `dist/play.html` 复制到交付目录，更新 PROGRESS.md，提交并推送该款分支，发送 Windows 通知。

单款失败不影响下一款。重跑会跳过已交付的游戏、从已有工作区续跑未完成的游戏，并补推尚未推送的里程碑。账户用量耗尽且能解析重置时间时，启动器会等待后继续。

## 日志位置

- 每次运行的日志：`run-logs/<时间戳>/`（已被 `.gitignore` 排除），包含 `launcher.log`、每个会话的提示词与输出、每轮验证日志。
- 每款的累计成本与状态：`game-recreations-cache/state/<id>.json`。
- 模拟沙盒：`game-recreations-cache/sim/<时间戳>/`。

## 离线试玩

双击交付目录中的 HTML 即可在桌面浏览器中游玩，无需联网或本地服务器。也可以自行构建：

```powershell
git checkout game/<id>
cd games\<id>
npm ci
npm run build      # 生成 dist/play.html
```

各游戏的按键、构建和测试结果见其 `games/<id>/README.md` 与 `DELIVERY.md`。

## 许可证

项目代码以 [MIT](LICENSE) 许可发布。第三方依赖和素材保留各自的许可证与声明，详见各游戏的 README。

## References

- [wquguru/fable52-fps-repro](https://github.com/wquguru/fable52-fps-repro)：程序化素材、单文件 HTML、浏览器自测和可复查运行记录的做法参考。
- [Three.js](https://threejs.org/)、[Vite](https://vite.dev/)、[Playwright](https://playwright.dev/)
