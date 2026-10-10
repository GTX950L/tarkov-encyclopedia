/* 由 scripts/gen_progress_manifest.py 生成，请勿手工编辑。
   用途：「我的进度」各轨的只读分母与列表（任务 / 剧情章节 / 物品收集 / 藏身处）。
   数据源与 content/quests/*.md、content/entries/hideout-modules.md、
   content/entries/story-chapters.md 同源（storylines.json 手维护、与剧情页对账），
   重抓数据或改动上述页面后，要按脚本头部写的顺序重跑。 */
window.TARKOV_PROGRESS_MANIFEST = {
  "generated": "2026-10-10",
  "source": "scripts/data/quests.json（json.tarkov.dev/regular，持久 PvP） + scripts/data/hideout.json（同源，含 hideout_zh / items_zh 译名） + scripts/data/storylines.json（手维护，与剧情页对账）",
  "baseline": "2026-09-30",
  "total": 515,
  "traders": [
    {
      "slug": "mechanic",
      "name": "Mechanic",
      "count": 89
    },
    {
      "slug": "prapor",
      "name": "Prapor",
      "count": 66
    },
    {
      "slug": "skier",
      "name": "Skier",
      "count": 66
    },
    {
      "slug": "jaeger",
      "name": "Jaeger",
      "count": 64
    },
    {
      "slug": "ragman",
      "name": "Ragman",
      "count": 58
    },
    {
      "slug": "therapist",
      "name": "Therapist",
      "count": 52
    },
    {
      "slug": "peacekeeper",
      "name": "Peacekeeper",
      "count": 51
    },
    {
      "slug": "fence",
      "name": "Fence",
      "count": 16
    },
    {
      "slug": "ref",
      "name": "Ref（竞技场裁判）",
      "count": 20
    },
    {
      "slug": "btr-driver",
      "name": "BTR 司机",
      "count": 19
    },
    {
      "slug": "lightkeeper",
      "name": "Lightkeeper",
      "count": 14
    }
  ],
  "items": {
    "threshold": 3,
    "total": 79,
    "note": "「任务数」是有多少个任务需要它；「合计数量」是这些任务要求的**总件数**（跨任务求和，不是单次需求）。只列被 3 个及以上任务需要的物品。",
    "list": [
      {
        "name": "WIFI摄像头",
        "tasks": 9,
        "qty": 47,
        "traders": "Fence / Mechanic / Skier / Ref / Prapor / Therapist"
      },
      {
        "name": "“凶狠跑刀崽”私酒",
        "tasks": 6,
        "qty": 33,
        "traders": "BTR 司机 / Skier / Ragman / Ref / Lightkeeper"
      },
      {
        "name": "卢布",
        "tasks": 5,
        "qty": 4400000,
        "traders": "Mechanic / Skier / Therapist / Fence / Ref"
      },
      {
        "name": "军用COFDM无线信号发射器",
        "tasks": 5,
        "qty": 21,
        "traders": "Mechanic / Peacekeeper / Prapor / Skier"
      },
      {
        "name": "咸狗牛肉肠",
        "tasks": 5,
        "qty": 21,
        "traders": "Jaeger / BTR 司机 / Ref / Lightkeeper"
      },
      {
        "name": "LEDX皮肤透照仪",
        "tasks": 5,
        "qty": 15,
        "traders": "Therapist"
      },
      {
        "name": "BEAR 狗牌",
        "tasks": 4,
        "qty": 575,
        "traders": "Peacekeeper / Prapor / Fence"
      },
      {
        "name": "Dan Jackiel瓶装威士忌",
        "tasks": 4,
        "qty": 46,
        "traders": "Ragman / Skier / Fence / Ref"
      },
      {
        "name": "Tarkovskaya瓶装伏特加",
        "tasks": 4,
        "qty": 45,
        "traders": "Ragman / BTR 司机 / Skier / Ref"
      },
      {
        "name": "SJ6 TGLabs 战斗兴奋剂注射器",
        "tasks": 4,
        "qty": 43,
        "traders": "Therapist / Mechanic / Skier"
      },
      {
        "name": "M.U.L.E. 兴奋剂注射器",
        "tasks": 4,
        "qty": 40,
        "traders": "Therapist / Peacekeeper / Skier"
      },
      {
        "name": "米屈肼注射器",
        "tasks": 4,
        "qty": 40,
        "traders": "Therapist / Peacekeeper / Skier"
      },
      {
        "name": "SJ9 TGLabs 战斗兴奋剂注射器",
        "tasks": 4,
        "qty": 39,
        "traders": "Therapist / Mechanic / Skier"
      },
      {
        "name": "OLOLO瓶装复合维生素",
        "tasks": 4,
        "qty": 32,
        "traders": "Therapist"
      },
      {
        "name": "邪教徒之刃",
        "tasks": 4,
        "qty": 32,
        "traders": "Fence / Lightkeeper / Skier / Jaeger"
      },
      {
        "name": "加密U盘",
        "tasks": 4,
        "qty": 27,
        "traders": "Skier / Jaeger / Peacekeeper / Mechanic"
      },
      {
        "name": "6B43 屏障-Sh 防弹衣（数码丛林迷彩）",
        "tasks": 4,
        "qty": 23,
        "traders": "Ragman / Jaeger"
      },
      {
        "name": "Salewa急救包",
        "tasks": 4,
        "qty": 22,
        "traders": "Therapist / Jaeger"
      },
      {
        "name": "BNTI Gzhel-K（彩瓷-K）防弹衣",
        "tasks": 4,
        "qty": 21,
        "traders": "Ragman / Jaeger"
      },
      {
        "name": "医用输血工具",
        "tasks": 4,
        "qty": 20,
        "traders": "Skier / Therapist"
      },
      {
        "name": "肾上腺素注射器",
        "tasks": 4,
        "qty": 20,
        "traders": "Therapist"
      },
      {
        "name": "检眼镜",
        "tasks": 4,
        "qty": 16,
        "traders": "Therapist"
      },
      {
        "name": "3-(b-TG) 兴奋剂注射器",
        "tasks": 4,
        "qty": 12,
        "traders": "Therapist / Peacekeeper"
      },
      {
        "name": "AHF1-M 兴奋剂注射器",
        "tasks": 4,
        "qty": 12,
        "traders": "Therapist / Peacekeeper"
      },
      {
        "name": "金属燃料桶",
        "tasks": 4,
        "qty": 10,
        "traders": "Peacekeeper / BTR 司机 / Jaeger"
      },
      {
        "name": "USEC 狗牌",
        "tasks": 3,
        "qty": 235,
        "traders": "Prapor / Peacekeeper / Fence"
      },
      {
        "name": "一堆药",
        "tasks": 3,
        "qty": 48,
        "traders": "Therapist"
      },
      {
        "name": "炖牛肉罐头",
        "tasks": 3,
        "qty": 45,
        "traders": "Therapist / Jaeger / Ref"
      },
      {
        "name": "显示卡",
        "tasks": 3,
        "qty": 42,
        "traders": "Mechanic / Prapor / Skier"
      },
      {
        "name": "Obdolbos 2 鸡尾酒兴奋剂注射器",
        "tasks": 3,
        "qty": 38,
        "traders": "Therapist / Skier"
      },
      {
        "name": "Propital 再生兴奋剂注射器",
        "tasks": 3,
        "qty": 38,
        "traders": "Therapist / Skier"
      },
      {
        "name": "SJ12 TGLabs 战斗兴奋剂注射器",
        "tasks": 3,
        "qty": 38,
        "traders": "Therapist / Skier"
      },
      {
        "name": "eTG-change 再生兴奋剂注射器",
        "tasks": 3,
        "qty": 38,
        "traders": "Therapist / Skier"
      },
      {
        "name": "BNTI Zhuk（甲虫）防弹衣（数码丛林迷彩）",
        "tasks": 3,
        "qty": 31,
        "traders": "Skier / Jaeger / Ragman"
      },
      {
        "name": "Vulkan-5 (火神) LShZ-5 重型防弹头盔 (黑色)",
        "tasks": 3,
        "qty": 31,
        "traders": "Jaeger / Skier / Ragman"
      },
      {
        "name": "呼吸面罩",
        "tasks": 3,
        "qty": 31,
        "traders": "Skier / Ragman"
      },
      {
        "name": "电线",
        "tasks": 3,
        "qty": 31,
        "traders": "Mechanic / Prapor"
      },
      {
        "name": "MRE个人即食口粮",
        "tasks": 3,
        "qty": 25,
        "traders": "Peacekeeper / Jaeger / Ref"
      },
      {
        "name": "Emelya黑麦面包块",
        "tasks": 3,
        "qty": 23,
        "traders": "BTR 司机 / Jaeger / Ref"
      },
      {
        "name": "SJ1 TGLabs 战斗兴奋剂注射器",
        "tasks": 3,
        "qty": 23,
        "traders": "Therapist / Mechanic"
      },
      {
        "name": "黑麦面包块",
        "tasks": 3,
        "qty": 23,
        "traders": "BTR 司机 / Jaeger / Ref"
      },
      {
        "name": "FORT Defender-2 防弹衣",
        "tasks": 3,
        "qty": 22,
        "traders": "Ragman / Jaeger"
      },
      {
        "name": "FORT Redut-M（堡垒-M）防弹衣",
        "tasks": 3,
        "qty": 22,
        "traders": "Ragman / Jaeger"
      },
      {
        "name": "一次性注射器",
        "tasks": 3,
        "qty": 18,
        "traders": "Therapist"
      },
      {
        "name": "Iskra（“火花”）单兵口粮",
        "tasks": 3,
        "qty": 17,
        "traders": "Jaeger / Ref"
      },
      {
        "name": "Trijicon REAP-IR热成像步枪瞄准镜",
        "tasks": 3,
        "qty": 17,
        "traders": "Mechanic / Skier / Lightkeeper"
      },
      {
        "name": "雷硼嬉皮太阳镜",
        "tasks": 3,
        "qty": 17,
        "traders": "Ragman"
      },
      {
        "name": "AFAK单兵急救包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "AI-2急救组合",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "CALOK-B止血剂",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "CAT止血带",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "CMS手术包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "Esmarch止血带",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "Grizzly急救包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "IFAK单兵急救包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "Surv12野战手术包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "Virtex可编程处理器",
        "tasks": 3,
        "qty": 16,
        "traders": "Peacekeeper / Prapor / Skier"
      },
      {
        "name": "军用绷带",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "印制电路板",
        "tasks": 3,
        "qty": 16,
        "traders": "Mechanic / Prapor"
      },
      {
        "name": "固定夹板",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "无菌绷带",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "车载急救包",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "铝固定夹板",
        "tasks": 3,
        "qty": 16,
        "traders": "Jaeger / Therapist"
      },
      {
        "name": "电子元件",
        "tasks": 3,
        "qty": 15,
        "traders": "Mechanic / Prapor"
      },
      {
        "name": "Tigzresq 夹板",
        "tasks": 3,
        "qty": 14,
        "traders": "Jaeger / Therapist / Fence"
      },
      {
        "name": "VOG-25 Khattabka 简易手榴弹",
        "tasks": 3,
        "qty": 14,
        "traders": "BTR 司机 / Prapor / Peacekeeper"
      },
      {
        "name": "便携式除颤器",
        "tasks": 3,
        "qty": 14,
        "traders": "Therapist"
      },
      {
        "name": "纯净水",
        "tasks": 3,
        "qty": 14,
        "traders": "Ragman / Therapist / Ref"
      },
      {
        "name": "电脑CPU",
        "tasks": 3,
        "qty": 13,
        "traders": "Mechanic / Prapor"
      },
      {
        "name": "气体分析仪",
        "tasks": 3,
        "qty": 11,
        "traders": "Therapist / Mechanic"
      },
      {
        "name": "盐水溶液",
        "tasks": 3,
        "qty": 11,
        "traders": "Therapist"
      },
      {
        "name": "0.6升瓶装水",
        "tasks": 3,
        "qty": 10,
        "traders": "Jaeger / Therapist / Ref"
      },
      {
        "name": "L1（去甲肾上腺素）注射器",
        "tasks": 3,
        "qty": 10,
        "traders": "Therapist / Peacekeeper"
      },
      {
        "name": "Obdolbos 鸡尾酒兴奋剂注射器",
        "tasks": 3,
        "qty": 10,
        "traders": "Therapist / Peacekeeper"
      },
      {
        "name": "P22 (22 号化合物) 兴奋剂注射器",
        "tasks": 3,
        "qty": 10,
        "traders": "Therapist / Peacekeeper"
      },
      {
        "name": "5升丙烷罐",
        "tasks": 3,
        "qty": 9,
        "traders": "Skier / Peacekeeper"
      },
      {
        "name": "MS2000指示器",
        "tasks": 3,
        "qty": 6,
        "traders": "Skier / BTR 司机"
      },
      {
        "name": "完好的硬盘驱动器",
        "tasks": 3,
        "qty": 6,
        "traders": "Mechanic / Skier / Peacekeeper"
      },
      {
        "name": "裁判的黑料",
        "tasks": 3,
        "qty": 6,
        "traders": "Fence / Ref / Lightkeeper"
      }
    ]
  },
  "hideout": {
    "total": 26,
    "levelCount": 68,
    "itemCount": 317,
    "source": "json.tarkov.dev/regular（官方数据端点，二级）+ hideout_zh / items_zh（同一套译名）",
    "baseline": "2026-10-06",
    "note": "「材料」是该等级需要的建材与数量；「战局中」标记的必须自己带出，跳蚤市场买的不算数。",
    "list": [
      {
        "en": "generator",
        "name": "发电机",
        "layer": "地基层",
        "alias": "生成器",
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "安保",
                "en": "security"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 100000,
                "fir": false
              },
              {
                "name": "火花塞",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "安保",
                "en": "security"
              },
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电线",
                "count": 15,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 10,
                "fir": false
              },
              {
                "name": "Bulbex剪线器",
                "count": 1,
                "fir": false
              },
              {
                "name": "电动马达",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 57600,
            "stations": [
              {
                "level": 3,
                "name": "安保",
                "en": "security"
              },
              {
                "level": 3,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "供电单元",
                "count": 5,
                "fir": true
              },
              {
                "name": "电动马达",
                "count": 3,
                "fir": true
              },
              {
                "name": "火花塞",
                "count": 16,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 12,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 10,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "solar-power",
        "name": "太阳能",
        "layer": "地基层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 259200,
            "stations": [
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 3,
                "name": "工作台",
                "en": "workbench"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "完好的液晶显示屏",
                "count": 3,
                "fir": true
              },
              {
                "name": "欧元",
                "count": 25000,
                "fir": false
              },
              {
                "name": "军用电源滤波器",
                "count": 10,
                "fir": false
              },
              {
                "name": "军用电缆",
                "count": 10,
                "fir": false
              },
              {
                "name": "相控阵单元",
                "count": 6,
                "fir": false
              },
              {
                "name": "直流变压器",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "lavatory",
        "name": "卫生间",
        "layer": "生存层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 2000,
                "fir": false
              },
              {
                "name": "卫生纸",
                "count": 1,
                "fir": false
              },
              {
                "name": "牙膏",
                "count": 1,
                "fir": false
              },
              {
                "name": "缝纫锥",
                "count": 1,
                "fir": false
              },
              {
                "name": "肥皂",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "集水器",
                "en": "water-collector"
              },
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 1,
                "name": "卫生间",
                "en": "lavatory"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "一包螺钉",
                "count": 6,
                "fir": false
              },
              {
                "name": "波纹软管",
                "count": 6,
                "fir": false
              },
              {
                "name": "KEKTAPE管道胶带",
                "count": 3,
                "fir": false
              },
              {
                "name": "针线盒",
                "count": 2,
                "fir": false
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 25200,
            "stations": [
              {
                "level": 2,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 2,
                "name": "集水器",
                "en": "water-collector"
              },
              {
                "level": 2,
                "name": "卫生间",
                "en": "lavatory"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "压力表",
                "count": 2,
                "fir": true
              },
              {
                "name": "一套工具",
                "count": 1,
                "fir": true
              },
              {
                "name": "波纹软管",
                "count": 10,
                "fir": false
              },
              {
                "name": "Xenomorph发泡密封胶",
                "count": 6,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "medstation",
        "name": "医疗站",
        "layer": "生存层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 50000,
                "fir": false
              },
              {
                "name": "无菌绷带",
                "count": 2,
                "fir": false
              },
              {
                "name": "OLOLO瓶装复合维生素",
                "count": 1,
                "fir": false
              },
              {
                "name": "一堆药",
                "count": 1,
                "fir": false
              },
              {
                "name": "一次性注射器",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 1,
                "name": "医疗站",
                "en": "medstation"
              }
            ],
            "skills": [
              {
                "name": "Health",
                "level": 2
              }
            ],
            "items": [
              {
                "name": "卢布",
                "count": 150000,
                "fir": false
              },
              {
                "name": "Esmarch止血带",
                "count": 10,
                "fir": false
              },
              {
                "name": "盐水溶液",
                "count": 6,
                "fir": false
              },
              {
                "name": "医疗工具",
                "count": 3,
                "fir": false
              },
              {
                "name": "医用输血工具",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 43200,
            "stations": [
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "卫生间",
                "en": "lavatory"
              },
              {
                "level": 2,
                "name": "医疗站",
                "en": "medstation"
              }
            ],
            "skills": [
              {
                "name": "Vitality",
                "level": 3
              }
            ],
            "items": [
              {
                "name": "检眼镜",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 500000,
                "fir": false
              },
              {
                "name": "盐水溶液",
                "count": 10,
                "fir": false
              },
              {
                "name": "LEDX皮肤透照仪",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "nutrition-unit",
        "name": "营养部",
        "layer": "生存层",
        "alias": "营养单元",
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 25000,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 2,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 1,
                "fir": false
              },
              {
                "name": "罐装白盐",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 0,
            "stations": [
              {
                "level": 2,
                "name": "卫生间",
                "en": "lavatory"
              },
              {
                "level": 1,
                "name": "营养部",
                "en": "nutrition-unit"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "扳手",
                "count": 4,
                "fir": false
              },
              {
                "name": "波纹软管",
                "count": 4,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 3,
                "fir": false
              },
              {
                "name": "碱性换热器表面洗涤剂",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 50400,
            "stations": [
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "卫生间",
                "en": "lavatory"
              },
              {
                "level": 2,
                "name": "仓库",
                "en": "stash"
              },
              {
                "level": 2,
                "name": "营养部",
                "en": "nutrition-unit"
              }
            ],
            "skills": [
              {
                "name": "Metabolism",
                "level": 3
              }
            ],
            "items": [
              {
                "name": "Smoked Chimney下水道清洁剂",
                "count": 2,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 125000,
                "fir": false
              },
              {
                "name": "碳酸氢钠",
                "count": 5,
                "fir": false
              },
              {
                "name": "罐装 Majaica 咖啡豆",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "rest-space",
        "name": "休息区",
        "layer": "生存层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 10000,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 1,
                "fir": false
              },
              {
                "name": "经典火柴",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 1,
                "name": "休息区",
                "en": "rest-space"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 75000,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 5,
                "fir": false
              },
              {
                "name": "DVD光驱",
                "count": 1,
                "fir": false
              },
              {
                "name": "电磁铁",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 7200,
            "stations": [
              {
                "level": 2,
                "name": "休息区",
                "en": "rest-space"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电线",
                "count": 10,
                "fir": false
              },
              {
                "name": "电容",
                "count": 5,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 5,
                "fir": false
              },
              {
                "name": "GreenBat锂电池",
                "count": 4,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "water-collector",
        "name": "集水器",
        "layer": "生存层",
        "alias": "水收集器",
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "螺栓",
                "count": 5,
                "fir": false
              },
              {
                "name": "螺母",
                "count": 5,
                "fir": false
              },
              {
                "name": "波纹软管",
                "count": 4,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 3,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 7200,
            "stations": [
              {
                "level": 1,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 1,
                "name": "集水器",
                "en": "water-collector"
              }
            ],
            "skills": [
              {
                "name": "Attention",
                "level": 3
              }
            ],
            "items": [
              {
                "name": "波纹软管",
                "count": 6,
                "fir": false
              },
              {
                "name": "KEKTAPE管道胶带",
                "count": 5,
                "fir": false
              },
              {
                "name": "一套工具",
                "count": 2,
                "fir": false
              },
              {
                "name": "电动马达",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 57600,
            "stations": [
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "集水器",
                "en": "water-collector"
              },
              {
                "level": 2,
                "name": "供暖",
                "en": "heating"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "Elite钳子",
                "count": 2,
                "fir": true
              },
              {
                "name": "棘轮扳手",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 20000,
                "fir": false
              },
              {
                "name": "Shustrilo发泡密封胶",
                "count": 10,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "air-filtering-unit",
        "name": "空气过滤单元",
        "layer": "生产层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 172800,
            "stations": [
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 3,
                "name": "通风",
                "en": "vents"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "防毒面具滤罐",
                "count": 5,
                "fir": true
              },
              {
                "name": "美元",
                "count": 25000,
                "fir": false
              },
              {
                "name": "军用波纹软管",
                "count": 10,
                "fir": false
              },
              {
                "name": "军用电源滤波器",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "intelligence-center",
        "name": "情报中心",
        "layer": "生产层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "安保",
                "en": "security"
              },
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 1,
                "name": "工作台",
                "en": "workbench"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "地形调查地图",
                "count": 1,
                "fir": false
              },
              {
                "name": "完好的液晶显示屏",
                "count": 1,
                "fir": false
              },
              {
                "name": "工厂地图",
                "count": 1,
                "fir": false
              },
              {
                "name": "情报文件夹",
                "count": 1,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 2,
                "name": "安保",
                "en": "security"
              },
              {
                "level": 2,
                "name": "医疗站",
                "en": "medstation"
              },
              {
                "level": 2,
                "name": "营养部",
                "en": "nutrition-unit"
              },
              {
                "level": 1,
                "name": "情报中心",
                "en": "intelligence-center"
              }
            ],
            "skills": [
              {
                "name": "Attention",
                "level": 3
              }
            ],
            "items": [
              {
                "name": "损坏的硬盘",
                "count": 8,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 7,
                "fir": false
              },
              {
                "name": "加密U盘",
                "count": 3,
                "fir": false
              },
              {
                "name": "情报文件夹",
                "count": 3,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 3,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "情报中心",
                "en": "intelligence-center"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "军用COFDM无线信号发射器",
                "count": 2,
                "fir": true
              },
              {
                "name": "军用电缆",
                "count": 8,
                "fir": false
              },
              {
                "name": "军用闪存装置",
                "count": 8,
                "fir": false
              },
              {
                "name": "VPX闪存模块",
                "count": 2,
                "fir": false
              },
              {
                "name": "加密磁带盒",
                "count": 2,
                "fir": false
              },
              {
                "name": "GPS信号放大单元",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "vents",
        "name": "通风",
        "layer": "生产层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 25000,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "CPU风扇",
                "count": 5,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 5,
                "fir": false
              },
              {
                "name": "汽车蓄电池",
                "count": 1,
                "fir": false
              },
              {
                "name": "电动马达",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 36000,
            "stations": [
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "通风",
                "en": "vents"
              }
            ],
            "skills": [
              {
                "name": "Strength",
                "level": 2
              }
            ],
            "items": [
              {
                "name": "汽车蓄电池",
                "count": 4,
                "fir": true
              },
              {
                "name": "电动马达",
                "count": 4,
                "fir": true
              },
              {
                "name": "电线",
                "count": 14,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 10,
                "fir": false
              },
              {
                "name": "印制电路板",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "workbench",
        "name": "工作台",
        "layer": "生产层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "螺栓",
                "count": 2,
                "fir": false
              },
              {
                "name": "螺母",
                "count": 2,
                "fir": false
              },
              {
                "name": "Leatherman多功能工具钳",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 1,
                "name": "工作台",
                "en": "workbench"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "螺栓",
                "count": 10,
                "fir": false
              },
              {
                "name": "一套工具",
                "count": 3,
                "fir": false
              },
              {
                "name": "武器零件",
                "count": 3,
                "fir": false
              },
              {
                "name": "电钻",
                "count": 2,
                "fir": false
              },
              {
                "name": "「Master」锉刀套装",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 39604,
            "stations": [
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "仓库",
                "en": "stash"
              },
              {
                "level": 2,
                "name": "工作台",
                "en": "workbench"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "Elite钳子",
                "count": 2,
                "fir": true
              },
              {
                "name": "#FireKlean牌枪润滑油",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 395000,
                "fir": false
              },
              {
                "name": "罐装铝热剂",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "bitcoin-farm",
        "name": "比特币矿场",
        "layer": "收益层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 122400,
            "stations": [
              {
                "level": 2,
                "name": "情报中心",
                "en": "intelligence-center"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "供电单元",
                "count": 10,
                "fir": true
              },
              {
                "name": "CPU风扇",
                "count": 15,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 15,
                "fir": false
              },
              {
                "name": "T形插座",
                "count": 10,
                "fir": false
              },
              {
                "name": "VPX闪存模块",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 180000,
            "stations": [
              {
                "level": 1,
                "name": "比特币矿场",
                "en": "bitcoin-farm"
              },
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "印制电路板",
                "count": 15,
                "fir": true
              },
              {
                "name": "CPU风扇",
                "count": 15,
                "fir": false
              },
              {
                "name": "供电单元",
                "count": 10,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 10,
                "fir": false
              },
              {
                "name": "军用电源滤波器",
                "count": 5,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 381600,
            "stations": [
              {
                "level": 2,
                "name": "比特币矿场",
                "en": "bitcoin-farm"
              },
              {
                "level": 1,
                "name": "太阳能",
                "en": "solar-power"
              },
              {
                "level": 3,
                "name": "集水器",
                "en": "water-collector"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "CPU风扇",
                "count": 25,
                "fir": true
              },
              {
                "name": "硅胶管",
                "count": 15,
                "fir": false
              },
              {
                "name": "压力表",
                "count": 10,
                "fir": false
              },
              {
                "name": "电动马达",
                "count": 10,
                "fir": false
              },
              {
                "name": "6-STEN-140-M军用电池",
                "count": 2,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "booze-generator",
        "name": "酿酒处",
        "layer": "收益层",
        "alias": "私酒厂",
        "levels": [
          {
            "level": 1,
            "time": 172800,
            "stations": [
              {
                "level": 3,
                "name": "集水器",
                "en": "water-collector"
              },
              {
                "level": 3,
                "name": "营养部",
                "en": "nutrition-unit"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "压力表",
                "count": 2,
                "fir": true
              },
              {
                "name": "模拟温度计",
                "count": 2,
                "fir": true
              },
              {
                "name": "管道扳手",
                "count": 1,
                "fir": true
              },
              {
                "name": "波纹软管",
                "count": 10,
                "fir": false
              },
              {
                "name": "硅胶管",
                "count": 10,
                "fir": false
              },
              {
                "name": "螺旋散热器",
                "count": 5,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "cultist-circle",
        "name": "仪式圈",
        "layer": "收益层",
        "alias": "十字路口 / 供奉",
        "levels": [
          {
            "level": 1,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "安保",
                "en": "security"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电灯泡",
                "count": 5,
                "fir": true
              },
              {
                "name": "罐装白盐",
                "count": 3,
                "fir": true
              },
              {
                "name": "Paid杀蟑剂",
                "count": 1,
                "fir": true
              },
              {
                "name": "SurvL幸存者打火机",
                "count": 1,
                "fir": true
              },
              {
                "name": "施工用测量卷尺",
                "count": 1,
                "fir": true
              },
              {
                "name": "WIFI摄像头",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "scav-case",
        "name": "Scav宝箱",
        "layer": "收益层",
        "alias": "Scav 包裹",
        "levels": [
          {
            "level": 1,
            "time": 288000,
            "stations": [
              {
                "level": 2,
                "name": "情报中心",
                "en": "intelligence-center"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "金项链",
                "count": 8,
                "fir": true
              },
              {
                "name": "黄金骷髅指环",
                "count": 6,
                "fir": true
              },
              {
                "name": "劳力土潜水金腕表",
                "count": 4,
                "fir": true
              },
              {
                "name": "“凶狠跑刀崽”私酒",
                "count": 3,
                "fir": true
              },
              {
                "name": "青铜狮雕",
                "count": 3,
                "fir": true
              },
              {
                "name": "金公鸡塑像",
                "count": 1,
                "fir": true
              },
              {
                "name": "幸运Scav垃圾箱",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "security",
        "name": "安保",
        "layer": "收益层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 20000,
                "fir": false
              },
              {
                "name": "施工用测量卷尺",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 1,
                "name": "安保",
                "en": "security"
              }
            ],
            "skills": [
              {
                "name": "Endurance",
                "level": 2
              }
            ],
            "items": [
              {
                "name": "卢布",
                "count": 45000,
                "fir": false
              },
              {
                "name": "100毫升WD-40",
                "count": 2,
                "fir": false
              },
              {
                "name": "TP-200 砖型TNT",
                "count": 2,
                "fir": false
              },
              {
                "name": "Elite钳子",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 61200,
            "stations": [
              {
                "level": 3,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 2,
                "name": "安保",
                "en": "security"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "完好的液晶显示屏",
                "count": 2,
                "fir": true
              },
              {
                "name": "固态硬盘",
                "count": 1,
                "fir": true
              },
              {
                "name": "电线",
                "count": 10,
                "fir": false
              },
              {
                "name": "NIXXOR镜头",
                "count": 8,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "gym",
        "name": "健身区",
        "layer": "成长层",
        "alias": "健身房",
        "levels": [
          {
            "level": 1,
            "time": 14400,
            "stations": [
              {
                "level": 6,
                "name": "易碎墙",
                "en": "defective-wall"
              },
              {
                "level": 2,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 2,
                "name": "通风",
                "en": "vents"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "一套工具",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "金属切割剪刀",
                "count": 1,
                "fir": true
              },
              {
                "name": "绝缘胶带",
                "count": 5,
                "fir": false
              },
              {
                "name": "螺栓",
                "count": 5,
                "fir": false
              },
              {
                "name": "螺母",
                "count": 5,
                "fir": false
              },
              {
                "name": "100毫升WD-40",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "hall-of-fame",
        "name": "荣耀展柜",
        "layer": "成长层",
        "alias": "名人堂",
        "levels": [
          {
            "level": 1,
            "time": 43207,
            "stations": [
              {
                "level": 6,
                "name": "易碎墙",
                "en": "defective-wall"
              },
              {
                "level": 2,
                "name": "照明",
                "en": "illumination"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "圆嘴钳",
                "count": 1,
                "fir": true
              },
              {
                "name": "猫雕像",
                "count": 1,
                "fir": true
              },
              {
                "name": "一包钉子",
                "count": 5,
                "fir": false
              },
              {
                "name": "电灯泡",
                "count": 5,
                "fir": false
              },
              {
                "name": "绒布布料",
                "count": 5,
                "fir": false
              },
              {
                "name": "绝缘胶带",
                "count": 5,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 64800,
            "stations": [
              {
                "level": 1,
                "name": "荣耀展柜",
                "en": "hall-of-fame"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "Elite钳子",
                "count": 1,
                "fir": true
              },
              {
                "name": "一套工具",
                "count": 1,
                "fir": true
              },
              {
                "name": "技术指导文件",
                "count": 1,
                "fir": true
              },
              {
                "name": "金公鸡塑像",
                "count": 1,
                "fir": true
              },
              {
                "name": "节能灯泡",
                "count": 10,
                "fir": false
              },
              {
                "name": "一包螺钉",
                "count": 6,
                "fir": false
              },
              {
                "name": "Xenomorph发泡密封胶",
                "count": 5,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 3,
                "fir": false
              },
              {
                "name": "Poxeram冷焊膏",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 2,
                "name": "荣耀展柜",
                "en": "hall-of-fame"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "KEKTAPE管道胶带",
                "count": 3,
                "fir": true
              },
              {
                "name": "「Master」锉刀套装",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "青铜狮雕",
                "count": 1,
                "fir": true
              },
              {
                "name": "节能灯泡",
                "count": 15,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 15,
                "fir": false
              },
              {
                "name": "T形插座",
                "count": 6,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "library",
        "name": "图书馆",
        "layer": "成长层",
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 194400,
            "stations": [
              {
                "level": 3,
                "name": "休息区",
                "en": "rest-space"
              }
            ],
            "skills": [
              {
                "name": "HideoutManagement",
                "level": 5
              }
            ],
            "items": [
              {
                "name": "项链",
                "count": 2,
                "fir": true
              },
              {
                "name": "BakeEzy烹饪书",
                "count": 1,
                "fir": true
              },
              {
                "name": "马雕像",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 400000,
                "fir": false
              },
              {
                "name": "技术指导文件",
                "count": 8,
                "fir": false
              },
              {
                "name": "日记",
                "count": 5,
                "fir": false
              },
              {
                "name": "袖珍日记",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "shooting-range",
        "name": "靶场",
        "layer": "成长层",
        "alias": "射击场",
        "levels": [
          {
            "level": 1,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "照明",
                "en": "illumination"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 20000,
                "fir": false
              },
              {
                "name": "螺栓",
                "count": 1,
                "fir": false
              },
              {
                "name": "螺母",
                "count": 1,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 86400,
            "stations": [
              {
                "level": 3,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 2,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 1,
                "name": "靶场",
                "en": "shooting-range"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电动马达",
                "count": 3,
                "fir": true
              },
              {
                "name": "一套工具",
                "count": 1,
                "fir": true
              },
              {
                "name": "施工用测量卷尺",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "金属零件",
                "count": 8,
                "fir": false
              },
              {
                "name": "电线",
                "count": 6,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 6,
                "fir": false
              },
              {
                "name": "Poxeram冷焊膏",
                "count": 3,
                "fir": false
              },
              {
                "name": "WIFI摄像头",
                "count": 3,
                "fir": false
              },
              {
                "name": "一包螺钉",
                "count": 3,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 2,
                "name": "靶场",
                "en": "shooting-range"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "「Master」锉刀套装",
                "count": 1,
                "fir": true
              },
              {
                "name": "技术指导文件",
                "count": 1,
                "fir": true
              },
              {
                "name": "电线",
                "count": 10,
                "fir": false
              },
              {
                "name": "印制电路板",
                "count": 5,
                "fir": false
              },
              {
                "name": "电容",
                "count": 5,
                "fir": false
              },
              {
                "name": "电源线",
                "count": 5,
                "fir": false
              },
              {
                "name": "相位控制继电器",
                "count": 5,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 5,
                "fir": false
              },
              {
                "name": "Leatherman多功能工具钳",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "defective-wall",
        "name": "易碎墙",
        "layer": null,
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "医疗站",
                "en": "medstation"
              },
              {
                "level": 1,
                "name": "集水器",
                "en": "water-collector"
              }
            ],
            "skills": [],
            "items": []
          },
          {
            "level": 2,
            "time": 43200,
            "stations": [
              {
                "level": 1,
                "name": "易碎墙",
                "en": "defective-wall"
              }
            ],
            "skills": [],
            "items": []
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 2,
                "name": "易碎墙",
                "en": "defective-wall"
              }
            ],
            "skills": [],
            "items": []
          },
          {
            "level": 4,
            "time": 10800,
            "stations": [
              {
                "level": 3,
                "name": "易碎墙",
                "en": "defective-wall"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "Fierce Blow重击锤",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 5,
            "time": 10800,
            "stations": [
              {
                "level": 4,
                "name": "易碎墙",
                "en": "defective-wall"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "一套工具",
                "count": 1,
                "fir": false
              },
              {
                "name": "金属切割剪刀",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 6,
            "time": 43200,
            "stations": [
              {
                "level": 5,
                "name": "易碎墙",
                "en": "defective-wall"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "金属零件",
                "count": 5,
                "fir": false
              },
              {
                "name": "波纹软管",
                "count": 2,
                "fir": false
              },
              {
                "name": "电灯泡",
                "count": 2,
                "fir": false
              },
              {
                "name": "电线",
                "count": 2,
                "fir": false
              },
              {
                "name": "Elite钳子",
                "count": 1,
                "fir": false
              },
              {
                "name": "Xenomorph发泡密封胶",
                "count": 1,
                "fir": false
              },
              {
                "name": "一套工具",
                "count": 1,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 1,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "gear-rack",
        "name": "装备架",
        "layer": null,
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 21600,
            "stations": [
              {
                "level": 6,
                "name": "易碎墙",
                "en": "defective-wall"
              },
              {
                "level": 2,
                "name": "照明",
                "en": "illumination"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "缝纫锥",
                "count": 1,
                "fir": true
              },
              {
                "name": "针线盒",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 300000,
                "fir": false
              },
              {
                "name": "螺栓",
                "count": 15,
                "fir": false
              },
              {
                "name": "绒布布料",
                "count": 10,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 8,
                "fir": false
              },
              {
                "name": "Leatherman多功能工具钳",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 43200,
            "stations": [
              {
                "level": 1,
                "name": "荣耀展柜",
                "en": "hall-of-fame"
              },
              {
                "level": 1,
                "name": "装备架",
                "en": "gear-rack"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "扳手",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 800000,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 12,
                "fir": false
              },
              {
                "name": "芳纶纤维布料",
                "count": 10,
                "fir": false
              },
              {
                "name": "一包钉子",
                "count": 8,
                "fir": false
              },
              {
                "name": "Shustrilo发泡密封胶",
                "count": 5,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 5,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 2,
                "name": "荣耀展柜",
                "en": "hall-of-fame"
              },
              {
                "level": 2,
                "name": "装备架",
                "en": "gear-rack"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "「Master」锉刀套装",
                "count": 1,
                "fir": true
              },
              {
                "name": "棘轮扳手",
                "count": 1,
                "fir": true
              },
              {
                "name": "防弹衣维修套件",
                "count": 1,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 1200000,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 15,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 15,
                "fir": false
              },
              {
                "name": "Cordura聚酰胺面料",
                "count": 10,
                "fir": false
              },
              {
                "name": "KEKTAPE管道胶带",
                "count": 10,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "heating",
        "name": "供暖",
        "layer": null,
        "alias": "加热器",
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 25000,
                "fir": false
              },
              {
                "name": "经典火柴",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 1,
                "name": "供暖",
                "en": "heating"
              }
            ],
            "skills": [
              {
                "name": "Endurance",
                "level": 1
              }
            ],
            "items": [
              {
                "name": "卢布",
                "count": 50000,
                "fir": false
              },
              {
                "name": "Crickent打火机",
                "count": 5,
                "fir": false
              },
              {
                "name": "固体燃料",
                "count": 5,
                "fir": false
              },
              {
                "name": "Hunter火柴",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 28800,
            "stations": [
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 2,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 2,
                "name": "供暖",
                "en": "heating"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "相位控制继电器",
                "count": 4,
                "fir": true
              },
              {
                "name": "军用波纹软管",
                "count": 2,
                "fir": true
              },
              {
                "name": "电线",
                "count": 10,
                "fir": false
              },
              {
                "name": "螺旋散热器",
                "count": 10,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "illumination",
        "name": "照明",
        "layer": null,
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 10000,
                "fir": false
              },
              {
                "name": "Crickent打火机",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 0,
            "stations": [
              {
                "level": 1,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 1,
                "name": "照明",
                "en": "illumination"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电灯泡",
                "count": 14,
                "fir": false
              },
              {
                "name": "电线",
                "count": 10,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 21600,
            "stations": [
              {
                "level": 2,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 1,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 2,
                "name": "照明",
                "en": "illumination"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "电容",
                "count": 7,
                "fir": true
              },
              {
                "name": "卢布",
                "count": 50000,
                "fir": false
              },
              {
                "name": "电线",
                "count": 12,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 12,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "stash",
        "name": "仓库",
        "layer": null,
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 0,
            "stations": [],
            "skills": [],
            "items": []
          },
          {
            "level": 2,
            "time": 3600,
            "stations": [
              {
                "level": 1,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 1,
                "name": "仓库",
                "en": "stash"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 2500000,
                "fir": false
              },
              {
                "name": "一包螺钉",
                "count": 10,
                "fir": false
              },
              {
                "name": "一包钉子",
                "count": 5,
                "fir": false
              },
              {
                "name": "100毫升WD-40",
                "count": 4,
                "fir": false
              },
              {
                "name": "手摇钻",
                "count": 1,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 43200,
            "stations": [
              {
                "level": 2,
                "name": "通风",
                "en": "vents"
              },
              {
                "level": 2,
                "name": "供暖",
                "en": "heating"
              },
              {
                "level": 2,
                "name": "仓库",
                "en": "stash"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "卢布",
                "count": 8500000,
                "fir": false
              },
              {
                "name": "一包螺钉",
                "count": 15,
                "fir": false
              },
              {
                "name": "一包钉子",
                "count": 7,
                "fir": false
              },
              {
                "name": "电钻",
                "count": 2,
                "fir": false
              }
            ]
          },
          {
            "level": 4,
            "time": 345600,
            "stations": [
              {
                "level": 3,
                "name": "发电机",
                "en": "generator"
              },
              {
                "level": 3,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 3,
                "name": "供暖",
                "en": "heating"
              },
              {
                "level": 3,
                "name": "仓库",
                "en": "stash"
              },
              {
                "level": 2,
                "name": "情报中心",
                "en": "intelligence-center"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "棘轮扳手",
                "count": 2,
                "fir": true
              },
              {
                "name": "欧元",
                "count": 200000,
                "fir": false
              },
              {
                "name": "螺栓",
                "count": 10,
                "fir": false
              },
              {
                "name": "螺母",
                "count": 10,
                "fir": false
              },
              {
                "name": "Shustrilo发泡密封胶",
                "count": 8,
                "fir": false
              }
            ]
          }
        ]
      },
      {
        "en": "weapon-rack",
        "name": "武器架",
        "layer": null,
        "alias": null,
        "levels": [
          {
            "level": 1,
            "time": 43200,
            "stations": [
              {
                "level": 3,
                "name": "照明",
                "en": "illumination"
              },
              {
                "level": 2,
                "name": "仓库",
                "en": "stash"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "手摇钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "金属切割剪刀",
                "count": 1,
                "fir": true
              },
              {
                "name": "螺栓",
                "count": 15,
                "fir": false
              },
              {
                "name": "Xenomorph发泡密封胶",
                "count": 5,
                "fir": false
              },
              {
                "name": "一包钉子",
                "count": 5,
                "fir": false
              },
              {
                "name": "绝缘胶带",
                "count": 5,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 5,
                "fir": false
              }
            ]
          },
          {
            "level": 2,
            "time": 64800,
            "stations": [
              {
                "level": 2,
                "name": "靶场",
                "en": "shooting-range"
              },
              {
                "level": 2,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 3,
                "name": "仓库",
                "en": "stash"
              },
              {
                "level": 1,
                "name": "武器架",
                "en": "weapon-rack"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "「Master」锉刀套装",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "一包螺钉",
                "count": 10,
                "fir": false
              },
              {
                "name": "电线",
                "count": 10,
                "fir": false
              },
              {
                "name": "管道胶带",
                "count": 10,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 10,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 10,
                "fir": false
              },
              {
                "name": "武器零件",
                "count": 5,
                "fir": false
              },
              {
                "name": "Poxeram冷焊膏",
                "count": 3,
                "fir": false
              }
            ]
          },
          {
            "level": 3,
            "time": 86400,
            "stations": [
              {
                "level": 3,
                "name": "靶场",
                "en": "shooting-range"
              },
              {
                "level": 3,
                "name": "工作台",
                "en": "workbench"
              },
              {
                "level": 2,
                "name": "武器架",
                "en": "weapon-rack"
              }
            ],
            "skills": [],
            "items": [
              {
                "name": "KEKTAPE管道胶带",
                "count": 5,
                "fir": true
              },
              {
                "name": "#FireKlean牌枪润滑油",
                "count": 1,
                "fir": true
              },
              {
                "name": "技术指导文件",
                "count": 1,
                "fir": true
              },
              {
                "name": "电钻",
                "count": 1,
                "fir": true
              },
              {
                "name": "电线",
                "count": 15,
                "fir": false
              },
              {
                "name": "节能灯泡",
                "count": 15,
                "fir": false
              },
              {
                "name": "金属零件",
                "count": 10,
                "fir": false
              },
              {
                "name": "Shustrilo发泡密封胶",
                "count": 5,
                "fir": false
              }
            ]
          }
        ]
      }
    ]
  },
  "storyline": {
    "total": 10,
    "source": "中文 Wiki 实测（三级来源），经 content/entries/story-chapters.md §2.1 收录",
    "baseline": "2026-09-30",
    "note": "剧情章节是**纯手动记录**（未标记 / 进行中 / 已完成）：官方任务数据里没有「章节」这层结构，本站也没有章节→任务的映射 —— 算不出来就不算，这条轨只记你亲手标的那一下。",
    "list": [
      {
        "id": "tour",
        "en": "Tour",
        "zh": "游览",
        "objectives": 26,
        "axis": true,
        "note": "序章；Mechanic 起手"
      },
      {
        "id": "falling-skies",
        "en": "Falling Skies",
        "zh": "陨落之天",
        "objectives": 20,
        "axis": true,
        "note": "唯一的重大多叉"
      },
      {
        "id": "the-ticket",
        "en": "The Ticket",
        "zh": "车票",
        "objectives": 12,
        "axis": true,
        "note": "终章；四个结局"
      },
      {
        "id": "they-are-already-here",
        "en": "They Are Already Here",
        "zh": "他们已经来了",
        "objectives": 30,
        "axis": false,
        "note": "穿插"
      },
      {
        "id": "batya",
        "en": "Batya",
        "zh": null,
        "objectives": 38,
        "axis": false,
        "note": "穿插"
      },
      {
        "id": "boreas",
        "en": "Boreas",
        "zh": null,
        "objectives": 67,
        "axis": false,
        "note": "穿插（最长的一章）"
      },
      {
        "id": "the-unheard",
        "en": null,
        "zh": "无名者",
        "objectives": 24,
        "axis": false,
        "note": "穿插"
      },
      {
        "id": "accidental-witness",
        "en": null,
        "zh": "意外证人",
        "objectives": 18,
        "axis": false,
        "note": "穿插"
      },
      {
        "id": "labyrinth",
        "en": null,
        "zh": "探秘“迷宫”",
        "objectives": 14,
        "axis": false,
        "note": "穿插"
      },
      {
        "id": "blue-fire",
        "en": null,
        "zh": "神秘蓝焰",
        "objectives": 8,
        "axis": false,
        "note": "穿插（最短的一章）"
      }
    ]
  }
};
