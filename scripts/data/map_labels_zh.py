#!/usr/bin/env python3
"""地名与撤离点的中文译名表。

**为什么单独一个文件**：这张表是「人工核对过的译名」，与 `gen_maps.py` 的
抓取/投影逻辑不是一类东西 —— 前者要逐条核、会随版本增补，后者是稳定的管道。
分开放，改译名时不必在两千行生成器里翻找，review 时也一目了然。

译名的三条规矩
--------------
① **社区通行叫法优先，不按字面直译。**
   `White Bishop` 是「白象」不是「白色主教」；`Skeleton` 是「骨架楼」不是「骷髅」；
   `Crackhouse` 是「制毒屋」不是「裂开的房子」。地图译名的用途是**对上玩家口中的说法**，
   不是语言学作业。

② **游戏内以拉丁字母出现的虚构品牌一律保留原文**（`IDEA` / `OLI` / `Goshan` / `Kiba`）。
   理由很实在：**招牌上写的就是这个原文** —— 读者在地图上看到能直接对上商场里的门头；
   硬译成「理念超市」反而找不到。只给能明确对应的加类别词（`ASAP Winery` → ASAP 酒庄）。

③ **俄文招牌译成中文。** 俄文对中文读者等于不可读，译出来才有意义；
   原文用括号保留，方便对照（`АПТЕКА` → 药店）。

**拿不准的一律不出现在这张表里** —— 查不到就退回英文名显示。
一个错的译名，比一个英文名更糟（这条纪律与 `humanize_extract` 一致）。
"""

# 图 key → {上游英文名: 中文}
LABELS_ZH: dict[str, dict[str, str]] = {
    # ── 海关：第一批核对的 24 个，作为全站的风格基准 ──
    "customs": {
        "Big Red": "大红砖",
        "Dorms": "宿舍区",
        "New Gas": "新加油站",
        "Old Gas": "老煤气站",
        "Fortress": "堡垒",
        "Crackhouse": "制毒屋",
        "Streamer House": "主播屋",
        "Main Bridge": "主桥",
        "Sniper Hill": "狙击山",
        "Storage": "仓库区",
        "Trailer Park": "拖车公园",
        "Junk Bridge": "废桥",
        "Repair Shop": "修理厂",
        "Sniper Ridge": "狙击岭",
        "Old Construction": "老工地",
        "Skeleton": "骨架楼",
        "Warehouse 3": "3 号库",
        "Warehouse 4": "4 号库",
        "Warehouse 7": "7 号库",
        "Warehouse 17": "17 号库",
        "Depot": "货场",
        "Military Checkpoint": "军事检查站",
        "Bus Station": "公交站",
        "Powerline Tower": "电塔",
        # 立交桥 / 中心区 / 街区的**品牌名**：保留原文（招牌上就是它），能给确定类别的加类别词。
        # 不确定卖什么的（多数服饰品牌）**一律不猜** —— 猜错比英文更难用。
    },
    "factory": {
        "Office Building": "办公楼",
        "Main Office": "主办公区",
        "Breach Room": "破口房",
        "Locked Office": "上锁办公室",
        "North Stairs": "北楼梯",
        "South Stairs": "南楼梯",
        "Sky Bridge": "天桥",
        "Connector": "连接通道",
        "Locker Rooms": "更衣室",
        "Sinks": "水槽区",
        "Hole": "地洞",
        "Platform": "站台",
        "Servers": "服务器房",
        "Med Tent": "医疗帐篷",
        "Silos": "筒仓",
        "Heli Crash": "直升机残骸",
        "Pit": "深坑",
        "Underground Stash": "地下藏匿点",
        "Scav Bunker": "Scav 地堡",
        "Blue Containers": "蓝集装箱",
        "Wood Room": "木料房",
        "Glass Hall": "玻璃厅",
        "Boilers": "锅炉房",
        "Pumping Station": "泵站",
        "East Halls": "东厅",
        "Forklifts": "叉车区",
        "Rafters": "横梁层",
    },
    # 中心区的地名几乎全是**虚构企业名**，社区一律用原文；只给能明确对应的加类别词。
    "ground-zero": {
        "ASAP Winery": "ASAP 酒庄",
        "GAGRIN Hotel": "GAGRIN 酒店",
        "M Showroom": "M 展厅",
        "Science Office": "科学办公室",
        "TerraGroup": "TerraGroup 总部",
    },
    "interchange": {
        "Power Station": "发电站",
        "Go Kart": "卡丁车场",
        "Four Camp": "四号营地",
        "Cargo Containers": "货运集装箱",
        "Wall Break": "破墙",
        "Ramps": "匝道",
        "Oli Tower": "OLI 塔楼",
        "Idea Tower": "IDEA 塔楼",
        "Scav Camp": "Scav 营地",
        "Highway Construction": "公路工地",
        "Garage A": "A 车库",
        "Garage B": "B 车库",
        "Garage C": "C 车库",
        "Garage D": "D 车库",
        "Book Store": "书店",
        "Dino Clothes": "恐龙服饰",
        "Fashion Store": "时装店",
        "Urban Clothes": "Urban 服饰",
        # 俄文招牌 —— 游戏内就是西里尔字母，译成中文才有意义，原文用括号保留
        "ТАРЗДРАВ": "药店 ТАРЗДРАВ",
        "МЕБЕЛЬ МК": "家具店 МК",
        "ПУШКИН": "普希金餐厅",
        "МУЗЕЙ ИСТОРИИ": "历史博物馆",
        "ЗАКРЫТО НА РЕМОНТ": "装修中（告示）",
        "НА-СВЯЗИ": "通信营业厅",
        "СКОРО ОТКРЫТИЕ": "即将开业（告示）",
        "АПТЕКА": "药店",
    },
    "lighthouse": {
        "Train Yard": "列车场",
        "Drug Lab": "制毒实验室",
        "Water Treatment": "水处理厂",
        "Plant 1": "1 号厂房",
        "Plant 2": "2 号厂房",
        "Plant 3": "3 号厂房",
        "Pipes": "管道区",
        "Gunner Nest": "机枪巢",
        "Island": "岛屿",
        "Cabins": "木屋",
        "Cottages": "小屋",
        "Convenience": "便利店",
        "Red Brick": "红砖楼",
        "Hillside": "山坡",
        "Boathouses": "船库",
        "Dead Tree": "枯树",
        "Construction": "工地",
        "Pikes Peak Resort": "派克斯峰度假村",
        "Grand Chalet": "大木屋",
        "Tennis Court": "网球场",
        "Lightkeeper Island": "光明守护者岛",
        "Crash Site": "坠机点",
    },
    # 国际象棋代号 —— 中文社区也这么叫（「白象楼」），**不按字面译成「白色主教」**
    "reserve": {
        "K Buildings": "K 区建筑群",
        "White Queen": "白后",
        "White Pawn": "白兵",
        "Black Bishop": "黑象",
        "White Bishop": "白象",
        "White King": "白王",
        "Black Knight": "黑马",
        "White Knight": "白马",
        "White Rook": "白车",
        "Black Pawn": "黑兵",
        "Train Station": "火车站",
        "Barracks": "兵营",
        "E1 Bunkers": "E1 地堡群",
        "E2 Bunkers": "E2 地堡群",
        "д - Warehouse Bunkers": "д 区仓库地堡",
        "Garage": "车库",
        "Mechanic": "机修区",
        "Gas Station": "加油站",
        "Shipping Yard": "集装箱场",
        "Dome": "圆顶",
        "Tarmac": "停机坪",
    },
    "shoreline": {
        "Resort": "疗养院",
        "Power Station": "发电站",
        "Gas Station": "加油站",
        "Weather Station": "气象站",
        "Radio Tower": "无线电塔",
        "Swamp": "沼泽",
        "Village": "村庄",
        "Cabins": "木屋",
        "Cottages": "小屋",
        "Tank Bridge": "坦克桥",
        "Pier": "码头",
        "Scav Island": "Scav 岛",
        "Bus Stop": "公交站",
        "Construction": "工地",
        "Bunker": "地堡",
        "Crane": "吊车",
        "Scav Farm": "Scav 农场",
        "West Wing": "西楼",
        "East Wing": "东楼",
        "Admin": "行政楼",
    },
    "streets-of-tarkov": {
        "Primorsky Ave.": "滨海大道",
        "Kilmov St.": "克里莫夫街",
        "Nikitskaya St.": "尼基茨卡娅街",
        "Verhnyaya St.": "上街",
        "Malevecha St.": "马列维恰街",
        "Chekannaya St.": "切坎纳亚街",
        "Nizhnyaya St.": "下街",
        "Razvedchikov St.": "侦察兵街",
        "Zmejskij Alley": "蛇巷",
        "Kamchatskaya St.": "堪察加街",
        "Kilmov Shopping Mall": "克里莫夫商场",
        "Cardinal Apartments": "红衣主教公寓",
        "Construction": "工地",
        "Sparja Grocery": "Sparja 杂货店",
        "Cinema": "电影院",
        "Pinewood Hotel": "松林酒店",
        "Concordia": "康科迪亚公寓",
        "Cardinal Bank": "红衣主教银行",
        "LERM Expo": "LERM 会展中心",
        "Sparja Express": "Sparja 便利店",
        "Post Office": "邮局",
        "Pharmacy 1": "1 号药店",
        "Pharmacy 2": "2 号药店",
        "Pharmacy 3": "3 号药店",
        "Office": "办公室",
        "Corner Restaurant": "街角餐厅",
        "School": "学校",
        "Vet Clinic": "兽医诊所",
        "Family Market": "家庭超市",
        "Marked Hotel": "标记酒店",
        "South Hotel": "南酒店",
        "Abandon Factory": "废弃工厂",
        "Diner": "快餐店",
        "Primorskij 49": "滨海街 49 号",
        "Prestigio Cafe": "Prestigio 咖啡馆",
        "Bilbo Coffee": "Bilbo 咖啡",
    },
    "the-lab": {
        "Parking": "停车场",
        "Vestibules #1": "1 号门厅",
        "Vestibules #2": "2 号门厅",
        "Main Working Area": "主工作区",
        "Negotiation Room": "谈判室",
        "Infirmary Lvl 1": "一层医务室",
        "Test Room": "测试间",
        "Server Room": "服务器房",
        "Warehouse Tunnels": "仓库隧道",
        "Warehouse": "仓库",
        "Warehouse Gate": "仓库大门",
        "Lecture Hall": "报告厅",
        "Recreation Area": "休息区",
        "Gym": "健身房",
        "Men's Locker Room": "男更衣室",
        "Women's Locker Room": "女更衣室",
        "Boiler Room": "锅炉房",
        "Security Barracks": "安保营房",
        "Reception": "前台",
        "Administrative Office": "行政办公室",
        "Security Office": "安保办公室",
        "Security #1": "1 号安保室",
        "Security #2": "2 号安保室",
        "Conference Room": "会议室",
        "Cafeteria": "餐厅",
        "Offices #1": "1 号办公区",
        "Offices #2": "2 号办公区",
        "Infirmary Lvl 2": "二层医务室",
        "Sterile Laboratory": "无菌实验室",
        "Control Room": "控制室",
        "Corridor To Building #2": "通往 2 号楼的走廊",
    },
    "woods": {
        "Sawmill": "锯木厂",
        "Scav Town": "Scav 村",
        "Old Sawmill": "老锯木厂",
        "Cultist Village": "邪教徒村",
        "USEC Camp": "USEC 营地",
        "Military Camp": "军营",
        "Ponds": "水塘",
        "Crash Site": "坠机点",
        "Checkpoint": "检查站",
        "Shack": "木棚",
        "Lumber": "木料场",
        "Cabins": "木屋",
        "Bus Stop": "公交站",
        "Jaeger's Camp": "Jaeger 营地",
        "Sniper Rock": "狙击石",
        "Convoy": "车队残骸",
    },
}

# 撤离点名：`humanize_extract()` 剥掉 `ex_<图>_` 与阵营前缀后的**核心片段** → 中文。
# 表里没有的，由 `humanize_extract` 退回「下划线转空格 + 首字母大写」。
EXTRACT_ZH: dict[str, str] = {
    # 通用
    "gasstation": "加油站",
    "crossroads": "十字路口",
    "boiler": "锅炉房",
    "admin": "行政楼",
    "trailerpark": "拖车停车场",
    "rail_milbase": "铁路军事基地",
    "rail_port": "铁路口岸",
    "rail_tarkov": "铁路（往塔科夫）",
    "rail": "铁路",
    "railway": "铁路",
    "milbase_cp": "军事基地检查站",
    "medgate": "医疗门",
    "flare": "信号弹撤离点",
    "auto": "付费车辆撤离点",
    "zb1011": "ZB-1011",
    "zb1013": "ZB-013",
    "bunker": "地堡",
    "boat": "船",
    "voron_boat": "渡鸦号船",
    "voron_bunker": "渡鸦地堡",

    # ── 关于 `_free_exit` 这类后缀（2026-10-14 修正）──
    # 撤：原先译作「XX 免费出口」，**两处不准**：
    #   ① `_free_exit` 是**游戏内部标识**，不是显示名的一部分 ——
    #      中文维基把同一后缀的 `Nakatani_stairs_free_exit` 写作「Nakatani 地下室楼梯」，不带「免费」；
    #   ② **"free" 在这里是「无条件」的意思，不是「不花钱」** ——
    #      而中心区恰好有个**要缴 5000 卢布**的 V-Exit（`Sandbox_VExit`），
    #      两个标签并排（「免费出口」vs「付费车辆出口」）会把区别误导到「钱」上。
    # 改为：**地名 + 出口**；没有地名可用的（`shorl_free`）才写「无条件出口」。
    # 与站内其他图的处理也就一致了 —— 海关的 `ex_customs_scav_gasstation` 一直译作「加油站」，
    # 同样没有把类型后缀译进去。
    # 工厂（Gate 系列是编号门，社区就叫「3 号门」）
    "gate_0": "0 号门",
    "gate_2": "2 号门",
    "gate_3": "3 号门",
    "gate_m": "m 号门",
    "gate_o": "o 号门",
    "cellars": "地窖",
    "office_window": "办公区窗户",
    "camera_bunker_door": "摄像地堡门",
    "camera_bunker": "摄像地堡",
    "factory_secret_ark": "秘密出口（ARK）",
    # 中心区
    "nakatani_stairs_free_exit": "Nakatani 楼梯出口",
    "scav_coop_exit": "Scav 合作出口",
    "groundzero_secret_adaptation": "秘密出口（适应）",
    "exit_e10_coop": "E10 合作出口",
    "sniper_exit": "狙击手出口",
    "un_roadblock": "联合国检查站",
    "unity_free_exit": "Unity 银行出口",
    "east_gate": "东门",
    "sandbox_vexit": "付费车辆出口",
    "sniper": "狙击手出口",
    # 立交桥
    "saferoom": "安全屋",
    "emercom": "EMERCOM 出口",
    "basement": "地下",
    "hole_exfill": "地洞出口",
    # 灯塔
    "exfil_train": "火车撤离",
    "coastal_south_road": "南滨海路",
    "scav_coastal_south": "Scav · 南滨海路",
    "shorl_free_scav": "Scav 出口",
    "alpinist_light": "登山者（轻装）",
    "lighthouse_secret_minefield": "秘密出口（雷区）",
    "nothern_checkpoint": "北检查站",
    "scav_underboat_hideout": "Scav 船下藏身处",
    "scav_hideout_at_the_grotto": "Scav 岩洞藏身处",
    "scav_industrial_zone": "Scav 工业区",
    "tunnel_shared": "隧道（共用）",
    "shorl_free": "无条件出口",
    # 储备站
    "exit1": "1 号出口",
    "exit2": "2 号出口",
    "exit3": "3 号出口",
    "exit4": "4 号出口",
    "reserve_secret_minefield": "秘密出口（雷区）",
    "alpinist": "登山者",
    "exfil_vent": "通风口撤离",
    "exfil_bunker_d2": "D2 地堡撤离",
    "exfil_bunker": "地堡撤离",
    "exfil_scavcooperation": "Scav 合作撤离",
    # 海岸线
    "redrebel_alp": "登山者（Red Rebel）",
    "adm_basement": "行政楼地下室",
    "tunnel": "隧道",
    "rock_passage": "岩间通道",
    "lighthouse": "灯塔",
    "smugglers_trail_coop": "走私小道（合作）",
    "svetliy_dead_end": "光明死路",
    "lighthouse_pass": "灯塔通道",
    "wrecked_road": "毁坏公路",
    "ccp_temporary": "CCP 临时出口",
    "scav_road_to_customs": "Scav · 通往海关",
    "rwing_gym_entrance": "西楼健身房入口",
    "road_to_customs": "通往海关",
    "road_at_railbridge": "铁路桥公路",
    "ruined_house_fence": "废墟围栏",
    "pier_boat": "码头小船",
    "shoreline_secret_heartbeat": "秘密出口（心跳）",
    "shorl_vex": "付费车辆出口",
    # 街区
    "e7_car": "E7 车辆出口",
    "e8_yard": "E8 院子出口",
    "e9_sniper": "E9 狙击手出口",
    "streets_secret_onyx": "秘密出口（缟玛瑙）",
    # 实验室
    "lab_hangar_gate": "机库大门",
    "lab_elevator_med": "医疗电梯",
    "lab_vent": "通风管道",
    "lab_elevator_cargo": "货运电梯",
    "lab_elevator_main": "主电梯",
    "lab_parking_gate": "停车场大门",
    "lab_under_storage_collector": "仓库下集流器",
    # 迷宫
    "labir_exit": "出口",
    "labyrinth_secret_tagilla_key": "秘密出口（Tagilla 钥匙）",
    # 森林
    "old_station": "老车站",
    "scav_house": "Scav 屋",
    "west_border": "西边界",
    "mountain_stash": "山间藏匿点",
    "wood_sniper_exit": "狙击手出口",
    "outskirts": "郊区",
    "ruaf_roadblock": "RUAF 检查站",
    "ruaf_gate": "RUAF 大门",
    "dead_man's_place": "死人地",
    "factory_gate": "工厂大门",
    "the_boat": "小船",
    "woods_secret_minefield": "秘密出口（雷区）",
    "south_vex": "南区付费车辆",
    # 跨图通用（多张图都有同名点）
    "exfil_train": "火车撤离",
    "un_roadblock": "联合国检查站",
}

# ── 第二批补录（2026-10-14，覆盖 13 张图后按实际漏项补）──
_EX_ADD = {
    "coop_exit": "合作撤离点",
    "heli": "直升机坪",
    "un_sec": "非安全出口",
    "zb014": "ZB-014",
    "zb016": "ZB-016",
}
EXTRACT_ZH.update(_EX_ADD)


# 上游直接给**可读英文名**的那批（不以 `ex_` 开头）—— 同样译出来。
# 键为「去掉非字母数字并小写」的归一化形式，见 `norm_key()`。
LABEL_EN_ZH: dict[str, str] = {
    "oldroadgate": "老路闸门",
    "ruafroadblock": "RUAF 检查站",
    "sniperroadblock": "狙击手检查站",
    "factoryshacks": "工厂棚屋",
    "warehouse4": "4 号仓库",
    "beyondfueltank": "油罐外",
    "holdexfill": "地洞出口",
    "exit2": "2 号出口",
    "exit1": "1 号出口",
    "exit3": "3 号出口",
    "exit4": "4 号出口",
    "exfiltrain": "火车撤离",
    "unroadblock": "联合国检查站",
}


def norm_key(s: str) -> str:
    """归一化查表键：**去掉一切非字母数字并小写**。

    上游的写法很杂 —— `Gate m`（带空格）、`EXFIL_Train`（大写下划线）、
    `Shorl_V-Ex`（连字符）、`gate_3`（小写下划线）……
    按「原样字符串」查表必然漏掉大半，归一化后一张表全接住。
    """
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


# ── 归一化后的查表（模块加载时构建一次）──
# ⚠️ **必须连表键一起归一化**：只归一化查询串是不够的 ——
# 表里写 `"gate_m"`，查询串归一化成 `"gatem"`，两边对不上就永远查不到。
# 这个坑真踩过：第一版撤离点名一个都没命中，原因就是这里。
EXTRACT_BY_KEY: dict[str, str] = {norm_key(k): v for k, v in EXTRACT_ZH.items()}
LABEL_EN_BY_KEY: dict[str, str] = {norm_key(k): v for k, v in LABEL_EN_ZH.items()}



# ── 跨图通用：品牌与机构名 ──
# 同一个品牌会在多张图出现（`Burger Spot` 在立交桥与街区都有、`Tarbank` 在中心区与街区都有），
# 逐图登记必然漏。这一层作**兜底**：按图查不到时再查这里。
#
# **为什么品牌保留原文**：游戏里的门头就写着这个原文 —— 读者在地图上看到能直接对上；
# 硬译成「理念超市」反而找不到。能给确定类别的加中文类别词（`IDEA` → IDEA 超市），
# **不确定的一律不猜**（多数服饰品牌只说品牌名）—— 猜错比英文更难用。
GLOBAL_LABELS_ZH: dict[str, str] = {
    "IDEA": "IDEA 电器城",
    "OLI": "OLI 超市",
    "Goshan": "Goshan 杂货区",
    "EMERCOM": "EMERCOM 医疗站",
    "Kiba": "KIBA 军械店",
    "Tarducks": "Tarducks 咖啡",
    "Coffee Joy": "Coffee Joy 咖啡",
    "McDaniels": "McDaniels 快餐",
    "Burger Spot": "Burger Spot 快餐",
    "Burger House": "Burger House 快餐",
    "Underway": "Underway 快餐",
    "Sushi Huyushi": "Sushi Huyushi 寿司",
    "Intourist": "Intourist 旅行社",
    "Beluga": "Beluga 餐厅",
    "Shestyorochka": "Shestyorochka 商店",
    "Hive": "Hive 商店",
    "Skyside": "Skyside 大厦",
    "Fusion": "Fusion 大厦",
    "Empire": "Empire 大厦",
    "Capital Insight": "Capital Insight 大厦",
    "Nakatani": "Nakatani 大厦",
    "Elemental Global": "Elemental Global 大厦",
    "Oasis": "Oasis 大厦",
    "Tarbank": "Tarbank 银行",
}
