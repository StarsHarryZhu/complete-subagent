# complete-subagent（完全子代理）

DeepSeek Harness 插件：一套**独立的子代理工具**，带**子工作区**、**向父代理申请权限**，以及**由父代理选择子代理的模型和推理强度**。

官方子代理（`subagent` / `subagent_fork`）默认能改父代理整个项目里的任何文件，而且它的审批策略固定为「自动拒绝」，越权请求到不了父代理。本插件另外提供两个工具：

- `delegate`：派生一个全新的子代理，它看不到当前对话。
- `delegate_fork`：派生一个继承当前对话（已完成的轮次）的子代理。

用这两个工具派出的子代理：

- 父代理传的 `cwd` 就是子代理的**子工作区**，不存在时自动创建。子代理只能在子工作区和临时目录（如 `/tmp`）里修改文件。
- `writable_paths`：派生时就预先授权子工作区以外的路径，省掉一次申请。
- 不传 `cwd`，或 `cwd` 在父代理自己能写的范围之外，子代理就**没有子工作区**：能读，不能改（`writable_paths` 照样生效）。
- 子代理要改别的地方，调用 `request_write_access`（写明路径和理由）后**暂停等待**。父代理收到一条 `[write-access request wr-…]` 消息，用 `answer_write_request` 允许（可以收窄路径）或拒绝。超时没人回复就按拒绝处理（默认 10 分钟，可在设置里改）。
- 父代理随时可以用 `grant_write_access` 主动加授权、用 `revoke_write_access` 收回授权，立即生效。
- `model` / `reasoning_effort`：父代理可以给子代理换模型、调推理强度，范围由设置页决定（见下文）。

这些规则都写在工具说明和参数说明里，AI 一看工具就知道怎么用。

## 和官方子代理的关系

两套并存，互不修改：

- 官方的 `subagent` / `subagent_fork` 原样保留，用它们派出的子代理仍是官方行为，不受子工作区限制。
- 本插件的子代理跑在宿主自己的子代理运行时上（`spawn` / `fork` 两个后端），所以 `send_message`、`list_agents`、`interrupt_agent`、网页上点开子代理会话、完成通知、重启后恢复，都和官方子代理一样。用户设置的最大委派深度同样生效，到了深度上限这两个工具就不再出现。
- 一个**被限制的**子代理如果再用官方工具（或 workflow 等其他方式）派出下一级，下一级**继承它的限制**：只能改它能改的地方，而且不能再申请。所以官方工具不能拿来绕过子工作区。
- 网页上，这两个工具的调用显示为普通工具卡片，不是官方的「创建子智能体」卡片。

## 设置：可选的子代理模型和推理强度

在网页「插件」页打开本插件，就是设置页：

- **可选的子代理模型**：从模型列表里添加模型，每个模型下勾选允许的推理强度（都不勾就是全部）。
- 父代理只能从这个列表里给子代理选模型。父代理**自己的模型**总能用：不在列表里时可以选它支持的任何推理强度；在列表里就只能选勾选的那几档。
- 列表为空时，子代理只用父代理的模型，但父代理仍然可以调推理强度。
- 不传 `reasoning_effort` 时：用父代理的模型就沿用父代理当前的强度；换了模型就用该模型的默认强度，如果默认强度不在勾选范围内，就用勾选的第一档。
- **写入申请的等待时间（秒）**：最少 10 秒，默认 600 秒。
- 改完保存，AI 的下一步就生效，不用重启。

## 只在指定 preset 里生效：`presets`

插件还有两个配置项设置页上不显示，主要给**把本插件当子插件挂载的总包**在 patch 里写。第一个是 `presets`（字符串数组）。

- **默认 `[]`**：所有 preset 都生效。单独安装时就是这样，行为和没有这个配置项时完全一样。
- **非空**：只对这些 preset 的 agent 生效。agent 属于哪个 preset，按宿主记录的会话 preset 判断（`agentPresets.presetForSession`）。不在列表里的 agent（包括读不到 preset 的）：
  - 看不到 `delegate`、`delegate_fork`、`request_write_access`、`answer_write_request`、`grant_write_access`、`revoke_write_access` 这六个工具；
  - 提示词里不注入本插件的说明；
  - 它和它派出的子代理都不会产生绑定（不会被限制）。
- 列表里 preset 的 agent 用 `delegate` 派出的子代理继承父代理的 preset，所以照常可用。被限制的子代理用官方工具派出下一级时，即使下一级选了别的 preset，也照样继承限制，只是看不到本插件的工具和说明。

## 指定子代理的 preset：`childPreset`

另一个配置项 `childPreset`（字符串），同样不在设置页显示，由总包在 patch 里写。

- **默认空字符串**：不指定，子代理继承父代理的 preset，就是现在的行为。
- **非空**：`delegate` 派出的子代理跑在这个 preset 上（启动时在请求里带 `agentPreset`，和官方 `subagent` 工具的做法一样）。宿主只允许不继承父上下文的后端（`spawn`）指定 preset。
- `delegate_fork` 走 `fork` 后端，继承父代理的上下文，**永远不指定** preset，子代理照旧跟父代理同一个 preset。
- 子代理在不在服务范围内，按它自己的 preset 判断。所以配置了 `presets` 时，`childPreset` 也要写进 `presets`，否则子代理看不到 `request_write_access`，也收不到本插件的说明（它仍然受限制）。

## 只用列表里的模型：`ownModel`

`ownModel`（布尔）同样不在设置页显示，由总包在 patch 里写。

- **默认 `true`**：就是上面说的规则，父代理自己的模型总能用。
- **`false`，且模型列表非空**：`delegate` 派出的子代理只能跑列表里的模型。
  - 不传 `model`，用列表第一个，不再继承父代理的模型。
  - 只传 `reasoning_effort`，强度作用在列表第一个模型上。
  - 父代理自己的模型不在列表里就不能选，报错会列出可选项。
  - 不传强度时不沿用父代理的强度，即使父代理跑的正是这个模型：用该模型的默认强度，默认强度不在勾选范围内就用勾选的第一档。
- 列表为空时规则不变，子代理继承父代理的模型。
- `delegate_fork` 不受这个配置影响：它继承父代理的对话，默认还是父代理的模型。它的 `model` 可选项和 `delegate` 用同一份列表。

## 总包在运行时设置模型列表：`completeSubagent` 服务

总包可以让用户在自己的设置页选模型，再把列表交给本插件：

```ts
ctx.inject(['completeSubagent'], (child) => {
  child.completeSubagent.setChildModels([
    { provider: 'deepseek', model: 'model-a', reasoningEfforts: ['high'] },
    { provider: 'deepseek', model: 'model-b' }, // 不写强度，模型支持的都行
  ])
})
```

- 设置后取代配置里的 `models`，并重建两个工具，下一次请求就生效，不用重启。正在跑的子代理不受影响。
- 列表只存在内存里，这一行重新加载后就没了，所以要在服务出现时设一次（上面的 `ctx.inject`），设置变化时再设。
- 只有这一份配了 `childPreset` 才生效，否则什么都不做：单独安装的本插件没有 `childPreset`，它的列表属于用户的普通会话，总包不能改。
- 设成空列表，或者列表里没有一项合法，就回到列表为空时的规则。

## 用途：助理

助理（`@starsharryzhu/dsh-assistant`）把本插件挂成子插件，分两层：

- 用户的会话跑在隐藏的 `dsh-assisstant` preset（router）上，没有写文件的工具，只负责派活，以及审批子代理的写入申请。
- 子代理跑在 `dsh-assisstant-worker` preset 上，有完整工具，要改子工作区以外的东西时用 `request_write_access` 向 router 申请。
- `presets` 只列这两个 preset，所以这些工具不会出现在普通会话里。

```yaml
- id: dsh-assisstant-complete-subagent
  name: '@starsharryzhu/complete-subagent'
  config:
    presets: [dsh-assisstant, dsh-assisstant-worker]
    childPreset: dsh-assisstant-worker
    ownModel: false
```

嵌在组里的行不能在设置页编辑，所以模型列表由总包用 `setChildModels` 设置，申请超时用默认的 600 秒。

## 授权规则

- 路径以 `/` 结尾，或本来就是已存在的目录：**目录授权**，对所有工具生效，包括 bash。不存在的目录会由父代理的权限自动创建。
- 其他路径是**文件授权**，只对 `write` / `edit` / `str_replace_editor` 生效，bash 不行（宿主沙箱只接受目录形式的额外可写根）。
- 三种授权来源（`writable_paths`、`answer_write_request`、`grant_write_access`）规则相同：父代理只能授权它自己能改的路径。孙代理要的东西如果子代理也没权限，子代理得先向它的父代理申请。
- `revoke_write_access` 只能收回授权，不能收回子工作区本身。
- 授权跟着子代理走：子代理结束后再被 `send_message` 唤醒，或者重启 DSH 后，子工作区和授权仍然有效（存在 `~/.dsh/plugin-data/complete-subagent/children/`，按 `DSH_HOME` 定位）。

## 怎么做到的

- **不改 DSH 本身**，也不改任何 preset，也不改官方子代理工具。插件是一行顶层 bundle row，全局生效，所以标准模式、ptc、助理模式等所有 preset 都能用（配置了 `presets` 时只对列出的 preset 生效）。
- 宿主的 bash 内核沙箱、文件写入围栏、终端和代码模式，每次写入前都会问 `ctx.sandboxPolicy.resolve({ session })`。插件在加载期间包装这个方法，把子代理的可写范围收窄成「子工作区 + 授权」，卸载时还原。所以限制是内核级的，bash 也绕不过去。
- 派生时插件先算好子工作区和授权、检查模型和推理强度，再用预先分配的子代理 id 存好绑定，最后才启动子代理。所以子代理从第一步起就受限；启动失败就删掉绑定。
- 申请走宿主的相邻 agent 消息通道（`ctx.subagents.sendMessage`）：父代理在运行，就在下一步看到；空闲就自动开新一轮。
- 设置页是插件自带的网页端部分，通过宿主的设置表单读写配置，模型列表和模型选择器用的是同一份目录。

## 支持的宿主版本

DeepSeek Harness 0.2.1-rc.5 及以后、0.3 以前。DSH Desktop 现在用的就是 rc.5。

rc.5 比 0.2.2-alpha.2 少三样东西，插件会自己判断并换一种做法，不用配置：

| rc.5 没有 | 插件怎么做 | 区别 |
|---|---|---|
| `presetForSession` | 从会话的 `agentPreset` 投影读 preset | 没有 |
| 工具的 `when` 条件 | 给每个 agent 单独加 `tools.restrict` 过滤 | 新 agent 和切换 preset 立刻生效，其他变化下一步才生效 |
| `additionalWritableRoots` | write / edit 写授权路径时，把这一次调用的根目录换成授权的目录 | **bash 写不了任何授权路径**，子代理的说明里会写明 |

## 已知限制

- 父代理不受限时，它用官方工具、workflow 或其他插件（比如 Mnemon 的复盘代理）派出的子代理保持官方行为。
- 单个文件的授权只对 write / edit 工具有效，bash 写不了。在 0.2.1-rc.5 上，目录授权也一样。
- 父代理正在跑一个很长的工具调用时，申请要等那一步结束才能看到。
- 设置页只在网页版里有；桌面版还没测过。
- 在 0.2.1-rc.5 上：父代理已到深度上限时收到申请，`answer_write_request` 要晚一步才出现，申请可能因此超时并算作拒绝。这种情况只在用户中途调低深度上限时才会发生。
- 配置了 `presets` 时：以前在列表外的会话里存下的绑定，围栏照样生效，但那些会话看不到工具和说明，它们再派出的子代理也不受限制。
- 不要同时加载两份本插件（单独安装的一行加上总包里的子插件行）：两份会注册同名工具。

## 本地安装

在 DSH checkout 目录里运行（把路径换成本目录）：

```bash
pnpm dsh plugin --profile web add link:<本目录>
```

它会把本插件加进 `~/.dsh/profiles/web/package.json` 的依赖和 `dsh.profile.bundles`。然后重启 DSH。`link:` 安装不会构建，所以 `lib/` 要先构建好，本目录的 `node_modules`（`link-dev` 建的符号链接）也不能删。

## 开发

```bash
node scripts/link-dev.mjs
node build.js
node node_modules/vitest/vitest.mjs run
```

`link-dev` 从 `../../deepseek-harness`（或 `DSH_CHECKOUT`）链接 TypeScript、vitest、jsdom、Testing Library、React 和三个宿主包。`lib/` 是构建产物，但要提交。
