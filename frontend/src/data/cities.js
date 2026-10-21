// 全国主要城市（名称 + 拼音全拼，用于按拼音首字母排序分组）
export const cities = [
  { name: '北京', pinyin: 'beijing' },
  { name: '上海', pinyin: 'shanghai' },
  { name: '天津', pinyin: 'tianjin' },
  { name: '重庆', pinyin: 'chongqing' },
  { name: '哈尔滨', pinyin: 'haerbin' },
  { name: '长春', pinyin: 'changchun' },
  { name: '沈阳', pinyin: 'shenyang' },
  { name: '大连', pinyin: 'dalian' },
  { name: '石家庄', pinyin: 'shijiazhuang' },
  { name: '太原', pinyin: 'taiyuan' },
  { name: '呼和浩特', pinyin: 'huhehaote' },
  { name: '乌鲁木齐', pinyin: 'wulumuqi' },
  { name: '兰州', pinyin: 'lanzhou' },
  { name: '西宁', pinyin: 'xining' },
  { name: '银川', pinyin: 'yinchuan' },
  { name: '西安', pinyin: 'xian' },
  { name: '拉萨', pinyin: 'lasa' },
  { name: '成都', pinyin: 'chengdu' },
  { name: '贵阳', pinyin: 'guiyang' },
  { name: '昆明', pinyin: 'kunming' },
  { name: '南宁', pinyin: 'nanning' },
  { name: '海口', pinyin: 'haikou' },
  { name: '广州', pinyin: 'guangzhou' },
  { name: '深圳', pinyin: 'shenzhen' },
  { name: '珠海', pinyin: 'zhuhai' },
  { name: '东莞', pinyin: 'dongguan' },
  { name: '佛山', pinyin: 'foshan' },
  { name: '长沙', pinyin: 'changsha' },
  { name: '武汉', pinyin: 'wuhan' },
  { name: '郑州', pinyin: 'zhengzhou' },
  { name: '济南', pinyin: 'jinan' },
  { name: '青岛', pinyin: 'qingdao' },
  { name: '南京', pinyin: 'nanjing' },
  { name: '苏州', pinyin: 'suzhou' },
  { name: '无锡', pinyin: 'wuxi' },
  { name: '常州', pinyin: 'changzhou' },
  { name: '杭州', pinyin: 'hangzhou' },
  { name: '宁波', pinyin: 'ningbo' },
  { name: '温州', pinyin: 'wenzhou' },
  { name: '合肥', pinyin: 'hefei' },
  { name: '福州', pinyin: 'fuzhou' },
  { name: '厦门', pinyin: 'xiamen' },
  { name: '泉州', pinyin: 'quanzhou' },
  { name: '南昌', pinyin: 'nanchang' },
  { name: '三亚', pinyin: 'sanya' },
  { name: '香港', pinyin: 'xianggang' },
  { name: '澳门', pinyin: 'aomen' },
  { name: '台北', pinyin: 'taibei' },
];

/** 按拼音首字母分组排序（A-Z），返回 [{ letter, items: [...] }] */
export function groupCitiesByInitial(list) {
  const sorted = [...list].sort((a, b) => a.pinyin.localeCompare(b.pinyin));
  const groups = [];
  let current = null;
  for (const city of sorted) {
    const letter = city.pinyin.charAt(0).toUpperCase();
    if (!current || current.letter !== letter) {
      current = { letter, items: [] };
      groups.push(current);
    }
    current.items.push(city);
  }
  return groups;
}
