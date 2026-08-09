# Clash Mi JS 个人覆写

用于 **Clash Mi + Mihomo** 的个人在线 JS 覆写。机场订阅只提供节点；本脚本接管策略组、DNS、规则集与分流规则。

## 在线导入地址

优先使用 jsDelivr：

```text
https://cdn.jsdelivr.net/gh/254057007-eng/clashmi-js@main/clashmi.js
```

Raw GitHub 备用地址：

```text
https://raw.githubusercontent.com/254057007-eng/clashmi-js/main/clashmi.js
```

在 Clash Mi 中进入：

```text
配置覆写 / Profile Patch
→ 添加远程覆写
→ 类型选择 JS
→ 填入上方地址
```

将该覆写绑定到机场订阅后，刷新覆写并断开/重新连接即可生效。

## 更新方式

本仓库的 `main/clashmi.js` 是唯一活动版本。

```text
GitHub 更新脚本
→ Clash Mi 手动更新该远程覆写
→ 断开并重新连接
```

iOS 上不要依赖后台定时更新；以 Clash Mi 内手动“更新覆写”为准。

## 配置边界

| 内容 | 来源 / 所有者 |
|---|---|
| 节点、协议、订阅地址 | Clash Mi 本地机场订阅 |
| 策略组、DNS、规则、rule-providers | `clashmi.js` |
| TUN、iOS VPN Extension、路由 | Clash Mi 本地「核心设置 → TUN」 |

脚本不包含机场订阅地址、节点、UUID、密码、Token 或其他认证凭据。

## 当前包含的个人规则

- Emby CF 与直连 CDN / IP 精确分流；
- 公司内容组：默认 DIRECT，在公司网络手动切换为 `🌐 代理访问`；
- 金融、飞书、邮箱、Apple、Microsoft、流媒体、Telegram、Google、GitHub 等业务分流；
- Fake-IP、国内 / 远程 DNS 和地区节点动态分组。

## 注意

- 此仓库是个人规则配置，不是通用模板；其他人引用前应自行审查规则与 DNS 策略。
- 修改前请先保留当前 Git 提交；出现问题可用 GitHub 的 Revert 回退。
- Mihomo 不支持 Shadowrocket 的 `USER-AGENT` 规则，因此不使用该语法。
