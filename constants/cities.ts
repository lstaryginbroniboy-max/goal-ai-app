export interface City {
  name: string;
  utcOffset: number; // hours from UTC
}

export const CITIES: City[] = [
  // Россия
  { name: 'Калининград',        utcOffset: 2  },
  { name: 'Москва',             utcOffset: 3  },
  { name: 'Санкт-Петербург',    utcOffset: 3  },
  { name: 'Казань',             utcOffset: 3  },
  { name: 'Нижний Новгород',    utcOffset: 3  },
  { name: 'Краснодар',          utcOffset: 3  },
  { name: 'Ростов-на-Дону',     utcOffset: 3  },
  { name: 'Самара',             utcOffset: 4  },
  { name: 'Уфа',                utcOffset: 5  },
  { name: 'Екатеринбург',       utcOffset: 5  },
  { name: 'Пермь',              utcOffset: 5  },
  { name: 'Омск',               utcOffset: 6  },
  { name: 'Новосибирск',        utcOffset: 7  },
  { name: 'Красноярск',         utcOffset: 7  },
  { name: 'Томск',              utcOffset: 7  },
  { name: 'Иркутск',            utcOffset: 8  },
  { name: 'Якутск',             utcOffset: 9  },
  { name: 'Владивосток',        utcOffset: 10 },
  { name: 'Хабаровск',          utcOffset: 10 },
  { name: 'Магадан',            utcOffset: 11 },
  { name: 'Петропавловск-Камч.', utcOffset: 12 },
  // СНГ
  { name: 'Минск',              utcOffset: 3  },
  { name: 'Киев',               utcOffset: 3  },
  { name: 'Алматы',             utcOffset: 5  },
  { name: 'Астана',             utcOffset: 5  },
  { name: 'Ташкент',            utcOffset: 5  },
  { name: 'Баку',               utcOffset: 4  },
  { name: 'Тбилиси',            utcOffset: 4  },
  { name: 'Ереван',             utcOffset: 4  },
  { name: 'Бишкек',             utcOffset: 6  },
  // Международные
  { name: 'Лондон',             utcOffset: 1  },
  { name: 'Берлин',             utcOffset: 2  },
  { name: 'Париж',              utcOffset: 2  },
  { name: 'Дубай',              utcOffset: 4  },
  { name: 'Бангкок',            utcOffset: 7  },
  { name: 'Пекин',              utcOffset: 8  },
  { name: 'Токио',              utcOffset: 9  },
  { name: 'Нью-Йорк',           utcOffset: -4 },
  { name: 'Лос-Анджелес',       utcOffset: -7 },
];

export function getCityTime(city: City): { timeStr: string; dateStr: string } {
  const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
  const d = new Date(utcMs + city.utcOffset * 3600000);
  const timeStr = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const dateStr = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return { timeStr, dateStr };
}
