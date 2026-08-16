export const KEEP_LEVELS = {
  1:{slots:6,quota:2,seconds:0},2:{slots:8,quota:2,seconds:10_800},3:{slots:10,quota:3,seconds:28_800},
  4:{slots:13,quota:3,seconds:64_800},5:{slots:17,quota:4,seconds:172_800},6:{slots:24,quota:4,seconds:388_800},
} as const;
export const TERRAIN = {
  plain:{food:1,wood:1,stone:1,defense:1,speed:1},forest:{food:.85,wood:1.25,stone:1,defense:1.16,speed:.85},
  mountain:{food:.75,wood:.9,stone:1.3,defense:1.25,speed:.65},riverbank:{food:1.25,wood:1,stone:.9,defense:1.08,speed:.75},
  pass:{food:.8,wood:.8,stone:1.15,defense:1.38,speed:.65},arid:{food:.55,wood:.55,stone:1,defense:1.06,speed:.75},
} as const;
export const UNIT = {
  spearman:{attack:10,defense:16,speed:6,pop:1},maceman:{attack:15,defense:10,speed:6,pop:1},swordsman:{attack:21,defense:22,speed:5,pop:2},archer:{attack:17,defense:11,speed:6,pop:1},crossbowman:{attack:24,defense:18,speed:5,pop:2},horse_archer:{attack:25,defense:14,speed:9,pop:2},knight:{attack:42,defense:38,speed:7,pop:3},light_cavalry:{attack:28,defense:20,speed:10,pop:2},catapult:{attack:8,defense:12,speed:2,pop:5,siege:30},trebuchet:{attack:10,defense:14,speed:1.5,pop:7,siege:48},siege_tower:{attack:5,defense:25,speed:1.8,pop:6,siege:25},battering_ram:{attack:12,defense:20,speed:2.2,pop:5,siege:34},ladderman:{attack:7,defense:8,speed:4,pop:2,siege:6},engineer:{attack:4,defense:12,speed:5,pop:2,siege:3},assassin:{attack:35,defense:5,speed:8,pop:1},spy:{attack:2,defense:4,speed:9,pop:1},mercenary:{attack:25,defense:20,speed:6,pop:0},
} as const;
export type UnitType=keyof typeof UNIT; export type Composition=Partial<Record<UnitType,number>>;
