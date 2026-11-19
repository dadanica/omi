# 可爱咪 · Cute Meow

可爱咪的浏览器交互原型与记忆权限技术验证代码。当前是本机预览，不是已发布的微信小程序。

## 运行

需要 Python 3.9 或更新版本，无第三方 Python 依赖。在仓库根目录执行：

```sh
python3 -B outputs/cute-meow-prototype/app.py --port 8879
```

浏览器打开 http://127.0.0.1:8879/，在登录页点击“先体验一下”。首次启动自动生成虚构样本，本地记录保存在 `outputs/cute-meow-prototype/runtime/`，不纳入版本管理。

## 当前功能

- 聊天、通讯录、动态空间、我的四个导航入口。
- 个人咪用于沉浸记录；邀请对象用于共同聊天；添加可爱咪好友后可进入私人对话。
- 我的页面展示关于我；我的记忆从弧形侧栏进入。
- 本机消息保存、来源查询、权限隔离、关键词搜索与删除。
- 奶油色登录页、动物头像、右侧弧形菜单。

咪默认叫“个人咪”和“可爱咪”，没有预设具体姓名。共同取名确认流程尚未实现。微信/手机号认证、正式邀请、AI 对话与自动整理尚未接入；不以模拟回答代替真实 AI。动态仅保存在当前浏览器中，不会发送给好友。

## 目录

| 目录 | 内容 |
| --- | --- |
| `outputs/cute-meow-prototype/` | 页面、Python 预览服务、界面迭代记录 |
| `outputs/memory-backend/` | SQLite 权限、来源与删除验证 |
| `outputs/memory-lab/` | JavaScript 记忆规则实验 |

各目录内的历史设计文档保留迭代背景，当前界面规则以代码和本说明为准。

## 验证

```sh
python3 -B -m unittest discover -s outputs/cute-meow-prototype -p test_preview.py
python3 -B -m unittest discover -s outputs/memory-backend -p test_backend.py
node outputs/memory-lab/test.cjs
```

Node.js 仅用于 JavaScript 规则测试。测试使用临时数据，不修改本机体验数据库。浏览器布局与手势仍需人工验收。

## 使用边界

服务仅监听本机。体验身份切换不是真实认证，不应直接部署为公网生产服务。本仓库不包含用户聊天数据库、密钥或工作缓存。
