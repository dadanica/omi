# omi第一版视觉记录

## 方向

保持产品定位：共同记忆、个人记忆、与咪私人对话三个入口完整。界面是微信小程序体验的浏览器预览；桌面左右两侧的导览和体验说明不属于最终小程序页面。

参考用户提供的 Cute Chat 图：奶油白聊天主体、浅薄荷层次、淡黄油色右侧弧形菜单、圆角角色头像和宽松列表。没有使用参考图作为背景，没有复用其品牌和动物角色。

颜色：主背景 #FAF8F1，纸面 #FFFDF8，菜单 #EEEDCF，薄荷 #E1EBE5，正文 #414C44，次级 #7B8177。右侧菜单采用跨屏高度的椭圆背景形成左侧弧线，内容在独立安全区域排布。最终小程序实现需另做 WXSS 适配和真机验证。

首页为轻量空间列表；聊天保持消息流主体，个人空间默认聊天；记忆页以日期时间线呈现；咪头像统一进入私人单聊，猫咪档案保留独立入口。

## 原创头像资产

生成方式：内置 `image_gen.imagegen`，非 CLI。生成后复制进项目，不依赖生成目录。四象限通过 CSS 背景定位使用，无图片裁切或二次编辑。

资产文件：`static/assets/animals.png`。角色：小满（奶油猫）、桐桐（兔）、阿树（熊）、信使猫。属于本轮原创视觉草案，尚未作为最终品牌 IP 定稿。信使猫资产预留，不代表信使咪功能完成。

完整生成提示词：

> Use case: stylized-concept. Asset type: original animal avatar sprite sheet for a gentle Chinese private memory chat mini app. Generate a square 1024x1024 image divided conceptually into exactly four equal quadrants, no visible dividing lines, each quadrant has perfectly uniform warm ivory background #FAF8F1. Each animal centered in its quadrant, entire head and small upper body visible, generous margins. Top left: small round cream cat with tiny warm brown ears, subtle orange forehead patch, small black dot eyes, calm smile, mint neckerchief. Top right: warm beige bunny, long floppy ears, dusty pink cheeks. Bottom left: round soft cocoa brown bear with pale muzzle. Bottom right: same cream cat from top left carrying a small muted sage green envelope. Style: refined hand-drawn cute animal illustration, consistent warm cocoa thin slightly textured outline, matte low saturation fills, very subtle pencil texture, cozy and adult-friendly, no 3D, no plastic shine, no text, no letters, no icons, no watermarks, no accessories beyond those specified. These are four standalone original avatars to be cropped with CSS quadrant positions, keep each completely inside its own quadrant with at least 80px margin to quadrant edges. No shadows outside animal, uniform ivory background.

## 待视觉验收

浏览器访问权限未获批准，未生成或伪造页面截图。需要检查：手机窄屏、大字号、键盘顶起输入框、弧形菜单留白、头像尺寸、底部安全区、右滑与纵向滚动冲突、弹窗焦点与返回位置。静态代码和接口通过不等于上述项目已经通过。
