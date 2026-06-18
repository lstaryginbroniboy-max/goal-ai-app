export interface City {
  name: string;
  utcOffset: number; // hours from UTC
  lat: number;
  lon: number;
}

export const CITIES: City[] = [
  // Россия
  { name: 'Калининград',          utcOffset: 2,   lat: 54.71,  lon: 20.51  },
  { name: 'Москва',               utcOffset: 3,   lat: 55.75,  lon: 37.62  },
  { name: 'Санкт-Петербург',      utcOffset: 3,   lat: 59.93,  lon: 30.32  },
  { name: 'Казань',               utcOffset: 3,   lat: 55.79,  lon: 49.12  },
  { name: 'Нижний Новгород',      utcOffset: 3,   lat: 56.33,  lon: 44.00  },
  { name: 'Краснодар',            utcOffset: 3,   lat: 45.04,  lon: 38.98  },
  { name: 'Ростов-на-Дону',       utcOffset: 3,   lat: 47.23,  lon: 39.72  },
  { name: 'Самара',               utcOffset: 4,   lat: 53.20,  lon: 50.15  },
  { name: 'Уфа',                  utcOffset: 5,   lat: 54.74,  lon: 55.97  },
  { name: 'Екатеринбург',         utcOffset: 5,   lat: 56.83,  lon: 60.60  },
  { name: 'Пермь',                utcOffset: 5,   lat: 58.01,  lon: 56.25  },
  { name: 'Омск',                 utcOffset: 6,   lat: 54.99,  lon: 73.37  },
  { name: 'Новосибирск',          utcOffset: 7,   lat: 54.99,  lon: 82.90  },
  { name: 'Красноярск',           utcOffset: 7,   lat: 56.01,  lon: 92.87  },
  { name: 'Томск',                utcOffset: 7,   lat: 56.50,  lon: 84.97  },
  { name: 'Иркутск',              utcOffset: 8,   lat: 52.29,  lon: 104.30 },
  { name: 'Якутск',               utcOffset: 9,   lat: 62.03,  lon: 129.73 },
  { name: 'Владивосток',          utcOffset: 10,  lat: 43.12,  lon: 131.90 },
  { name: 'Хабаровск',            utcOffset: 10,  lat: 48.48,  lon: 135.08 },
  { name: 'Магадан',              utcOffset: 11,  lat: 59.57,  lon: 150.79 },
  { name: 'Петропавловск-Камч.',  utcOffset: 12,  lat: 53.01,  lon: 158.65 },
  // СНГ
  { name: 'Минск',                utcOffset: 3,   lat: 53.90,  lon: 27.57  },
  { name: 'Киев',                 utcOffset: 3,   lat: 50.45,  lon: 30.52  },
  { name: 'Алматы',               utcOffset: 5,   lat: 43.25,  lon: 76.92  },
  { name: 'Астана',               utcOffset: 5,   lat: 51.19,  lon: 71.45  },
  { name: 'Ташкент',              utcOffset: 5,   lat: 41.30,  lon: 69.24  },
  { name: 'Баку',                 utcOffset: 4,   lat: 40.41,  lon: 49.87  },
  { name: 'Тбилиси',              utcOffset: 4,   lat: 41.69,  lon: 44.83  },
  { name: 'Ереван',               utcOffset: 4,   lat: 40.18,  lon: 44.51  },
  { name: 'Бишкек',               utcOffset: 6,   lat: 42.87,  lon: 74.59  },
  // Международные
  { name: 'Лондон',               utcOffset: 1,   lat: 51.51,  lon: -0.13  },
  { name: 'Берлин',               utcOffset: 2,   lat: 52.52,  lon: 13.40  },
  { name: 'Париж',                utcOffset: 2,   lat: 48.86,  lon: 2.35   },
  { name: 'Дубай',                utcOffset: 4,   lat: 25.20,  lon: 55.27  },
  { name: 'Бангкок',              utcOffset: 7,   lat: 13.75,  lon: 100.52 },
  { name: 'Пекин',                utcOffset: 8,   lat: 39.91,  lon: 116.39 },
  { name: 'Токио',                utcOffset: 9,   lat: 35.69,  lon: 139.69 },
  { name: 'Нью-Йорк',             utcOffset: -4,  lat: 40.71,  lon: -74.01 },
  { name: 'Лос-Анджелес',         utcOffset: -7,  lat: 34.05,  lon: -118.24},
];

export function getCityTime(city: City): { timeStr: string; dateStr: string } {
  const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
  const d = new Date(utcMs + city.utcOffset * 3600000);
  const timeStr = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const dateStr = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return { timeStr, dateStr };
}

export async function fetchWeather(city: City): Promise<{ current: number; max: number } | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m&daily=temperature_2m_max&timezone=auto&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      current: Math.round(data.current.temperature_2m),
      max:     Math.round(data.daily.temperature_2m_max[0]),
    };
  } catch {
    return null;
  }
}
