const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 4000;
const TGSTAT_TOKEN = process.env.TGSTAT_TOKEN || '97bdcc340e3769bd70caea8f8dc6a0ef';

app.use(cors());
app.use(express.json());

// ═══════════ ПОМОЩНЫЕ ФУНКЦИИ ═══════════

function cleanChannel(input) {
  if (!input) return '';
  let clean = input.trim();
  clean = clean.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '');
  clean = clean.replace(/^@/, '');
  clean = clean.split(' ')[0];
  return clean;
}

function formatNum(n) {
  if (!n || n === 0) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

function getVerdict(erPercent) {
  if (!erPercent) return { label: 'Нет данных', color: 'muted', emoji: '⚪' };
  if (erPercent >= 8) return { label: 'Отлично', color: 'green', emoji: '🟢' };
  if (erPercent >= 4) return { label: 'Хорошо', color: 'green', emoji: '🟢' };
  if (erPercent >= 2) return { label: 'Средне', color: 'yellow', emoji: '🟡' };
  return { label: 'Низкий ER', color: 'red', emoji: '🔴' };
}

// ═══════════ API МАРШРУТЫ ═══════════

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'TG Bee API', version: '1.1.0' });
});

// Анализ канала
app.get('/api/channel/:username', async (req, res) => {
  const channel = cleanChannel(req.params.username);
  if (!channel) {
    return res.status(400).json({ error: 'Укажите username канала' });
  }

  try {
    // Шаг 1: Найти канал
    let ch = null;
    try {
      const getRes = await axios.get('https://api.tgstat.ru/channels/get', {
        params: { token: TGSTAT_TOKEN, channelId: '@' + channel }
      });
      ch = getRes.data?.response;
    } catch (e) {
      try {
        const searchRes = await axios.get('https://api.tgstat.ru/channels/search', {
          params: { token: TGSTAT_TOKEN, q: channel, limit: 1, country: 'ru' }
        });
        const items = searchRes.data?.response?.items;
        if (items && items.length > 0) ch = items[0];
      } catch (e2) {
        console.log('Search fallback error:', e2.message);
      }
    }

    if (!ch) {
      return res.status(404).json({ error: 'Канал не найден в TGStat', channel });
    }

    // Шаг 2: Получить статистику (тут ER, охват и т.д.)
    let stat = null;
    try {
      const statRes = await axios.get('https://api.tgstat.ru/channels/stat', {
        params: { token: TGSTAT_TOKEN, channelId: ch.id }
      });
      stat = statRes.data?.response;
    } catch (e) {
      console.log('TGStat stat (не критично):', e.message);
    }

    // Шаг 3: Собираем результат — приоритет данным из stat
    const username = (ch.username || channel).replace(/^@/, '');
    
    // ER: stat возвращает уже в процентах (6.34), а get может в долях (0.0634)
    const erPercent = stat?.er_percent || (ch.er ? ch.er * 100 : 0);
    const errPercent = stat?.err_percent || (ch.err ? ch.err * 100 : 0);
    const er24Percent = stat?.err24_percent || stat?.er24_percent || 0;
    const avgPostReach = stat?.avg_post_reach || ch.avg_post_reach || 0;
    const participants = stat?.participants_count || ch.participants_count || 0;
    const dailyReach = stat?.daily_reach || ch.daily_reach || 0;
    const postsCount = stat?.posts_count || 0;

    const result = {
      title: ch.title || channel,
      username: username,
      category: ch.category || '—',
      description: ch.about || ch.description || '—',
      
      // Подписчики
      participants: participants,
      participantsFormatted: formatNum(participants),
      
      // Охваты
      avgPostReach: avgPostReach,
      avgPostReachFormatted: formatNum(avgPostReach),
      dailyReach: dailyReach,
      dailyReachFormatted: formatNum(dailyReach),
      
      // ER (уже в процентах)
      er: erPercent,
      erFormatted: erPercent ? erPercent.toFixed(1) + '%' : '—',
      err: errPercent,
      errFormatted: errPercent ? errPercent.toFixed(1) + '%' : '—',
      er24: er24Percent,
      er24Formatted: er24Percent ? er24Percent.toFixed(1) + '%' : null,
      
      // Прочее
      ciIndex: ch.ci_index || stat?.ci_index || null,
      postsCount: postsCount,
      
      // Рекламные охваты
      advReach12h: stat?.adv_post_reach_12h || null,
      advReach24h: stat?.adv_post_reach_24h || null,
      advReach48h: stat?.adv_post_reach_48h || null,
      
      // Ссылки
      tgstatUrl: 'https://tgstat.ru/channel/@' + username,
      telegramUrl: 'https://t.me/' + username,
      
      // Вердикт
      verdict: getVerdict(erPercent),
    };

    res.json(result);

  } catch (error) {
    console.error('TGStat API error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Ошибка TGStat API', 
      details: error.response?.data?.error || error.message 
    });
  }
});

// Поиск каналов
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);

  if (!query) {
    return res.status(400).json({ error: 'Укажите параметр q' });
  }

  try {
    const searchRes = await axios.get('https://api.tgstat.ru/channels/search', {
      params: { token: TGSTAT_TOKEN, q: query, limit, country: 'ru' }
    });

    const items = searchRes.data?.response?.items || [];
    
    const results = items.map(ch => {
      const username = (ch.username || '').replace(/^@/, '');
      const erPercent = ch.er ? ch.er * 100 : 0;
      return {
        title: ch.title,
        username: username,
        participants: ch.participants_count || 0,
        participantsFormatted: formatNum(ch.participants_count),
        er: erPercent,
        erFormatted: erPercent ? erPercent.toFixed(1) + '%' : '—',
        avgPostReach: ch.avg_post_reach || 0,
        avgPostReachFormatted: formatNum(ch.avg_post_reach),
        category: ch.category || '—',
        verdict: getVerdict(erPercent),
      };
    });

    res.json({ results, total: results.length });

  } catch (error) {
    console.error('TGStat search error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Ошибка поиска', details: error.message });
  }
});

// ═══════════ ЗАПУСК ═══════════

app.listen(PORT, () => {
  console.log('TG Bee API v1.1 запущен на порту ' + PORT);
  console.log('http://localhost:' + PORT);
});
