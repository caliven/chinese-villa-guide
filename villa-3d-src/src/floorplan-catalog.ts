/*
 * Adapted from wy51ai/floorplan-3d, index.html (master), fetched 2026-10-22.
 * Upstream blob: 4c5d17f6eb1633ac27724b25d8f666c0f03737c0
 * https://github.com/wy51ai/floorplan-3d
 * Copyright (c) 2026 wuyi. Licensed under MIT; see public/licenses/floorplan-3d.txt.
 */

/** 上游完整目录。独立 ID 区分同类家具的规格、配色与名称。 */
export const floorplanFurniture = [
  {"id":"fp-bed-double-1800","type":"bed","name":"双人床 1.8m","w":1800,"d":2000,"color":"#c9d6df","category":"卧室"},
  {"id":"fp-bed-double-1500","type":"bed","name":"双人床 1.5m","w":1500,"d":2000,"color":"#d8c7dc","category":"卧室"},
  {"id":"fp-bed-single","type":"bed","name":"单人床","w":1200,"d":2000,"color":"#e8d5b5","category":"卧室"},
  {"id":"fp-crib","type":"crib","name":"婴儿床","w":1250,"d":700,"color":"#efe3d0","category":"卧室"},
  {"id":"fp-nightstand","type":"nightstand","name":"床头柜","w":450,"d":400,"color":"#e8dccb","category":"卧室"},
  {"id":"fp-wardrobe","type":"wardrobe","name":"衣柜","w":2000,"d":600,"color":"#efe6d8","category":"卧室"},
  {"id":"fp-wardrobe-small","type":"wardrobe","name":"小衣柜","w":1200,"d":550,"color":"#efe6d8","category":"卧室"},
  {"id":"fp-dresser","type":"dresser","name":"梳妆台","w":1000,"d":450,"color":"#efe6d8","category":"卧室"},
  {"id":"fp-desk","type":"desk","name":"书桌","w":1200,"d":600,"color":"#e2cfb4","category":"卧室"},
  {"id":"fp-chair","type":"chair","name":"椅子","w":450,"d":480,"color":"#cfc6b8","category":"卧室"},
  {"id":"fp-bookshelf","type":"bookshelf","name":"书架","w":800,"d":300,"color":"#e2cfb4","category":"卧室"},
  {"id":"fp-baycushion","type":"baycushion","name":"飘窗垫","w":520,"d":1800,"color":"#e7dccd","category":"卧室"},
  {"id":"fp-sofa-three","type":"sofa","name":"三人沙发","w":2400,"d":900,"color":"#b7c4b0","category":"客厅"},
  {"id":"fp-sofa-two","type":"sofa","name":"双人沙发","w":1700,"d":880,"color":"#c3cbd6","category":"客厅"},
  {"id":"fp-cornersofa","type":"cornersofa","name":"转角沙发","w":2800,"d":1700,"color":"#b7c4b0","category":"客厅"},
  {"id":"fp-armchair","type":"armchair","name":"单人沙发","w":850,"d":850,"color":"#d6b99a","category":"客厅"},
  {"id":"fp-beanbag","type":"beanbag","name":"懒人沙发","w":800,"d":800,"color":"#e0b98f","category":"客厅"},
  {"id":"fp-coffeetable","type":"coffeetable","name":"茶几","w":1300,"d":650,"color":"#e8dccb","category":"客厅"},
  {"id":"fp-sidetable","type":"sidetable","name":"边几","w":500,"d":500,"color":"#d9c3a3","category":"客厅"},
  {"id":"fp-tvstand","type":"tvstand","name":"电视柜","w":2400,"d":400,"color":"#e2cfb4","category":"客厅"},
  {"id":"fp-rug","type":"rug","name":"地毯","w":2400,"d":1700,"color":"#d9cbb8","category":"客厅"},
  {"id":"fp-shoecab","type":"shoecab","name":"鞋柜","w":1000,"d":350,"color":"#efe6d8","category":"客厅"},
  {"id":"fp-entry-cabinet","type":"shoecab","name":"玄关柜","w":1400,"d":380,"color":"#e6dccc","category":"客厅"},
  {"id":"fp-floorlamp","type":"floorlamp","name":"落地灯","w":450,"d":450,"color":"#3d3a34","category":"客厅"},
  {"id":"fp-plant","type":"plant","name":"绿植","w":500,"d":500,"color":"#a9c39b","category":"客厅"},
  {"id":"fp-plant-large","type":"plant","name":"大绿植","w":700,"d":700,"color":"#9dbb8c","category":"客厅"},
  {"id":"fp-table","type":"table","name":"餐桌","w":1400,"d":800,"color":"#e2cfb4","category":"餐厨"},
  {"id":"fp-table-six","type":"table","name":"六人餐桌","w":1800,"d":900,"color":"#d8c2a2","category":"餐厨"},
  {"id":"fp-roundtable","type":"roundtable","name":"圆桌","w":1000,"d":1000,"color":"#e2cfb4","category":"餐厨"},
  {"id":"fp-dining-chair","type":"chair","name":"餐椅","w":450,"d":480,"color":"#cfc6b8","category":"餐厨"},
  {"id":"fp-island","type":"island","name":"岛台","w":1800,"d":900,"color":"#e9e5de","category":"餐厨"},
  {"id":"fp-barstool","type":"barstool","name":"吧椅","w":420,"d":420,"color":"#6b5d4c","category":"餐厨"},
  {"id":"fp-counter","type":"counter","name":"橱柜台面","w":1600,"d":600,"color":"#e9e5de","category":"餐厨"},
  {"id":"fp-stove","type":"stove","name":"燃气灶","w":750,"d":450,"color":"#dcdcdc","category":"餐厨"},
  {"id":"fp-ksink","type":"ksink","name":"水槽","w":800,"d":450,"color":"#e1e6ea","category":"餐厨"},
  {"id":"fp-fridge","type":"fridge","name":"冰箱","w":700,"d":700,"color":"#dfe4e8","category":"餐厨"},
  {"id":"fp-sideboard","type":"cabinet","name":"餐边柜","w":1600,"d":400,"color":"#efe6d8","category":"餐厨"},
  {"id":"fp-toilet","type":"toilet","name":"马桶","w":400,"d":700,"color":"#ffffff","category":"卫浴"},
  {"id":"fp-vanity","type":"vanity","name":"浴室柜","w":800,"d":500,"color":"#eef1f3","category":"卫浴"},
  {"id":"fp-vanity-double","type":"vanity","name":"双盆浴室柜","w":1200,"d":500,"color":"#eef1f3","category":"卫浴"},
  {"id":"fp-shower","type":"shower","name":"淋浴房","w":900,"d":900,"color":"#e4edf2","category":"卫浴"},
  {"id":"fp-bathtub","type":"bathtub","name":"浴缸","w":1600,"d":750,"color":"#eef3f6","category":"卫浴"},
  {"id":"fp-washer","type":"washer","name":"洗衣机","w":600,"d":600,"color":"#e6ebee","category":"卫浴"},
  {"id":"fp-waterheater","type":"waterheater","name":"电热水器","w":800,"d":450,"color":"#f4f4f2","category":"卫浴"},
  {"id":"fp-storage-cabinet","type":"cabinet","name":"储物柜","w":1000,"d":400,"color":"#efe6d8","category":"卫浴"},
  {"id":"fp-tv-65","type":"tv","name":"65 寸电视","w":1450,"d":80,"color":"#1d1d1f","category":"家电"},
  {"id":"fp-tv-55","type":"tv","name":"55 寸电视","w":1230,"d":80,"color":"#1d1d1f","category":"家电"},
  {"id":"fp-fridge-double","type":"fridge","name":"对开门冰箱","w":910,"d":700,"color":"#c9ced3","category":"家电"},
  {"id":"fp-aircon","type":"aircon","name":"柜机空调","w":500,"d":380,"color":"#f6f7f8","category":"家电"},
  {"id":"fp-acwall","type":"acwall","name":"挂机空调","w":900,"d":250,"color":"#f6f7f8","category":"家电"},
  {"id":"fp-dishwasher","type":"dishwasher","name":"洗碗机","w":600,"d":600,"color":"#c9ced3","category":"家电"},
  {"id":"fp-ovencol","type":"ovencol","name":"蒸烤箱高柜","w":600,"d":600,"color":"#efe6d8","category":"家电"},
  {"id":"fp-dryer","type":"dryer","name":"烘干机","w":600,"d":600,"color":"#e6ebee","category":"家电"},
  {"id":"fp-purifier","type":"purifier","name":"空气净化器","w":400,"d":300,"color":"#f4f4f2","category":"家电"},
  {"id":"fp-desk-long","type":"desk","name":"长书桌","w":1600,"d":700,"color":"#d8c2a2","category":"书房 · 休闲"},
  {"id":"fp-officechair","type":"officechair","name":"办公椅","w":620,"d":620,"color":"#4a4f55","category":"书房 · 休闲"},
  {"id":"fp-bookshelf-large","type":"bookshelf","name":"大书架","w":1600,"d":350,"color":"#e2cfb4","category":"书房 · 休闲"},
  {"id":"fp-piano","type":"piano","name":"立式钢琴","w":1500,"d":600,"color":"#1f1d1b","category":"书房 · 休闲"},
  {"id":"fp-treadmill","type":"treadmill","name":"跑步机","w":800,"d":1800,"color":"#3a3a3c","category":"书房 · 休闲"},
  {"id":"fp-reading-chair","type":"armchair","name":"阅读椅","w":750,"d":800,"color":"#c9a98a","category":"书房 · 休闲"},
] as const;

export type FloorplanFurniture = (typeof floorplanFurniture)[number];
export type FloorplanFurnitureId = FloorplanFurniture["id"];
export type FloorplanFurnitureType = FloorplanFurniture["type"];
export const floorplanCategories = ["卧室","客厅","餐厨","卫浴","家电","书房 · 休闲"] as const;
const byId = new Map<string, FloorplanFurniture>(floorplanFurniture.map(item => [item.id, item]));

export function getFloorplanFurniture(kind: string): FloorplanFurniture | undefined {
  return byId.get(kind);
}

