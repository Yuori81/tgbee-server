const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 4000;
const TGSTAT_TOKEN = process.env.TGSTAT_TOKEN || '97bdcc340e3769bd70caea8f8dc6a0ef';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eujjvjneynhmuazgihlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1amp2am5leW5obXVhemdpaGx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NzY5NDksImV4cCI6MjA4OTE1Mjk0OX0.B9Zba0IcQM8A8kebpm8ixiglVtMuSdT9KYaDFDYR1-U';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// ═══════════ УМНЫЙ СКОРИНГ ═══════════

function getVerdict(data) {
  let score = 0;
  let maxScore = 0;
  const notes = [];

  // 1. ER (вес 25)
  const er = data.er || 0;
  maxScore += 25;
  if (er >= 10) { score += 25; }
  else if (er >= 6) { score += 20; }
  else if (er >= 4) { score += 15; }
  else if (er >= 2) { score += 8; }
  else if (er > 0) { score += 3; }

  if (er >= 6) notes.push('ER выше среднего — аудитория вовлечена');
  else if (er >= 2) notes.push('ER в норме, но есть куда расти');
  else if (er > 0) notes.push('ER низкий — возможна накрутка или неактивная аудитория');

  // 2. ERR (вес 10)
  const err = data.err || 0;
  maxScore += 10;
  if (err >= 15) { score += 10; }
  else if (err >= 8) { score += 7; }
  else if (err >= 3) { score += 4; }

  // 3. Охват поста относительно подписчиков (вес 15)
  const reach = data.avgPostReach || 0;
  const subs = data.participants || 0;
  maxScore += 15;
  if (subs > 0 && reach > 0) {
    const reachRatio = reach / subs;
    if (reachRatio >= 0.3) { score += 15; }
    else if (reachRatio >= 0.15) { score += 12; }
    else if (reachRatio >= 0.08) { score += 7; }
    else { score += 2; notes.push('Охват постов низкий относительно подписчиков'); }
  }

  // 4. Количество постов — активность (вес 10)
  const posts = data.postsCount || 0;
  maxScore += 10;
  if (posts >= 100) { score += 10; }
  else if (posts >= 30) { score += 7; }
  else if (posts >= 10) { score += 4; }
  else { notes.push('Мало публикаций — канал молодой или неактивный'); }

  // 5. Дневной охват (вес 8)
  maxScore += 8;
  if (data.dailyReach >= 500) { score += 8; }
  else if (data.dailyReach >= 100) { score += 6; }
  else if (data.dailyReach >= 20) { score += 3; }
  else if (data.dailyReach > 0) { score += 1; }
  else { notes.push('Дневной охват очень низкий'); }

  // 6. Индекс цитирования (вес 7)
  maxScore += 7;
  const ci = data.ciIndex || 0;
  if (ci >= 100) { score += 7; }
  else if (ci >= 30) { score += 5; }
  else if (ci >= 10) { score += 3; }
  else if (ci > 0) { score += 1; }

  // 7. Свежесть постов — КЛЮЧЕВОЙ ПАРАМЕТР (вес 25)
  maxScore += 25;
  if (data.lastPostDaysAgo !== null && data.lastPostDaysAgo !== undefined) {
    if (data.lastPostDaysAgo <= 1) { score += 25; }
    else if (data.lastPostDaysAgo <= 3) { score += 22; }
    else if (data.lastPostDaysAgo <= 7) { score += 15; }
    else if (data.lastPostDaysAgo <= 14) { score += 7; }
    else if (data.lastPostDaysAgo <= 30) { score += 3; }
    else { score += 0; }

    if (data.lastPostDaysAgo > 14) {
      notes.push('Последний пост ' + data.lastPostDaysAgo + ' дней назад — канал заброшен');
    } else if (data.lastPostDaysAgo > 7) {
      notes.push('Последний пост ' + data.lastPostDaysAgo + ' дней назад — канал малоактивен');
    } else if (data.lastPostDaysAgo <= 2) {
      notes.push('Канал публикует регулярно');
    }
  }

  // Нормализуем в 0-100
  const finalScore = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  // Определяем вердикт
  let label, color, emoji;
  if (finalScore >= 75) { label = 'Отлично'; color = 'green'; emoji = '🟢'; }
  else if (finalScore >= 55) { label = 'Хорошо'; color = 'green'; emoji = '🟢'; }
  else if (finalScore >= 35) { label = 'Средне'; color = 'yellow'; emoji = '🟡'; }
  else if (finalScore > 0) { label = 'Слабо'; color = 'red'; emoji = '🔴'; }
  else { label = 'Нет данных'; color: 'muted'; emoji = '⚪'; }

  // Генерируем рекомендации по правилам
  const recommendations = [];

  if (data.lastPostDaysAgo !== null && data.lastPostDaysAgo > 7) {
    recommendations.push('Канал неактивен — начните публиковать хотя бы 2-3 раза в неделю');
  }
  if (er < 4 && subs > 1000) {
    recommendations.push('ER ниже нормы при большой аудитории — проверьте качество подписчиков');
  }
  if (er >= 6 && subs < 5000) {
    recommendations.push('Хороший ER — самое время масштабировать через ВП');
  }
  if (reach > 0 && subs > 0 && (reach / subs) < 0.1) {
    recommendations.push('Охваты низкие — попробуйте увеличить частоту и разнообразие контента');
  }
  if (posts < 30) {
    recommendations.push('Публикуйте чаще — минимум 3-4 поста в неделю для роста');
  }
  if (er >= 4 && subs >= 1000 && data.lastPostDaysAgo !== null && data.lastPostDaysAgo <= 7) {
    recommendations.push('Попробуйте взаимопиар — ваш ER позволяет получить хороший отклик');
  }
  if (subs >= 3000 && er >= 3 && data.lastPostDaysAgo !== null && data.lastPostDaysAgo <= 7) {
    recommendations.push('Канал готов к тестовой рекламе — начните с бюджета 3-5 тыс ₽');
  }
  if (ci < 10) {
    recommendations.push('Низкая цитируемость — делайте уникальный контент, который хочется репостить');
  }

  return {
    label, color, emoji,
    score: finalScore,
    notes,
    recommendations: recommendations.slice(0, 4)
  };
}

// ═══════════ API МАРШРУТЫ ═══════════

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'TG Bee API', version: '2.1.0' });
});

app.post('/api/user', async (req, res) => {
  const { id, username, first_name } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const { data, error } = await supabase
      .from('users')
      .upsert({ id, username, first_name }, { onConflict: 'id' })
      .select();
    if (error) throw error;
    res.json({ user: data[0] });
  } catch (e) {
    console.error('User upsert error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════ АНАЛИЗ КАНАЛА ═══════════

app.get('/api/channel/:username', async (req, res) => {
  const channel = cleanChannel(req.params.username);
  const userId = req.query.userId || null;

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

    // Шаг 2: Статистика канала
    let stat = null;
    try {
      const statRes = await axios.get('https://api.tgstat.ru/channels/stat', {
        params: { token: TGSTAT_TOKEN, channelId: ch.id }
      });
      stat = statRes.data?.response;
    } catch (e) {
      console.log('TGStat stat (не критично):', e.message);
    }

    // Шаг 3: Последние посты (свежесть и активность)
    let lastPostDaysAgo = null;
    let avgViews = 0;
    try {
      const postsRes = await axios.get('https://api.tgstat.ru/channels/posts', {
        params: { token: TGSTAT_TOKEN, channelId: ch.id, limit: 5 }
      });
      const posts = postsRes.data?.response?.items || [];
      const activePosts = posts.filter(p => !p.is_deleted);
      if (activePosts.length > 0) {
        const latestDate = activePosts[0].date;
        const now = Math.floor(Date.now() / 1000);
        lastPostDaysAgo = Math.round((now - latestDate) / 86400);
        const totalViews = activePosts.reduce((sum, p) => sum + (p.views || 0), 0);
        avgViews = Math.round(totalViews / activePosts.length);
      }
    } catch (e) {
      console.log('Posts fetch (не критично):', e.message);
    }

    // Шаг 4: Собираем метрики
    const username = (ch.username || channel).replace(/^@/, '');
    const erPercent = stat?.er_percent || (ch.er ? ch.er * 100 : 0);
    const errPercent = stat?.err_percent || 0;
    const er24Percent = stat?.err24_percent || 0;
    const avgPostReach = stat?.avg_post_reach || ch.avg_post_reach || 0;
    const participants = stat?.participants_count || ch.participants_count || 0;
    const dailyReach = stat?.daily_reach || 0;
    const postsCount = stat?.posts_count || 0;

    // Шаг 5: Умный скоринг
    const verdict = getVerdict({
      er: erPercent,
      err: errPercent,
      avgPostReach,
      participants,
      postsCount,
      dailyReach,
      ciIndex: ch.ci_index || stat?.ci_index || 0,
      lastPostDaysAgo,
      avgViews
    });

    const result = {
      title: ch.title || channel,
      username: username,
      category: ch.category || '—',
      description: ch.about || ch.description || '—',
      participants, participantsFormatted: formatNum(participants),
      avgPostReach, avgPostReachFormatted: formatNum(avgPostReach),
      dailyReach, dailyReachFormatted: formatNum(dailyReach),
      er: erPercent, erFormatted: erPercent ? erPercent.toFixed(1) + '%' : '—',
      err: errPercent, errFormatted: errPercent ? errPercent.toFixed(1) + '%' : '—',
      er24: er24Percent, er24Formatted: er24Percent ? er24Percent.toFixed(1) + '%' : null,
      ciIndex: ch.ci_index || stat?.ci_index || null,
      postsCount,
      lastPostDaysAgo,
      avgViews,
      advReach12h: stat?.adv_post_reach_12h || null,
      advReach24h: stat?.adv_post_reach_24h || null,
      advReach48h: stat?.adv_post_reach_48h || null,
      tgstatUrl: 'https://tgstat.ru/channel/@' + username,
      telegramUrl: 'https://t.me/' + username,
      verdict,
    };

    // Сохраняем анализ в базу
    if (userId) {
      try {
        await supabase.from('users').upsert(
          { id: parseInt(userId), username: 'tg_user', first_name: 'User' },
          { onConflict: 'id' }
        );
        await supabase.from('analyses').insert({
          user_id: parseInt(userId),
          channel_username: username,
          participants,
          er: erPercent,
          err: errPercent,
          avg_post_reach: avgPostReach,
          daily_reach: dailyReach,
          ci_index: ch.ci_index || null,
          posts_count: postsCount,
          category: ch.category || null,
          verdict_label: verdict.label,
          verdict_color: verdict.color,
          raw_data: result,
        });
      } catch (e) {
        console.log('Save analysis error (не критично):', e.message);
      }
    }

    res.json(result);

  } catch (error) {
    console.error('TGStat API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Ошибка TGStat API', details: error.response?.data?.error || error.message });
  }
});

// ═══════════ ПОИСК КАНАЛОВ ═══════════

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  if (!query) return res.status(400).json({ error: 'Укажите параметр q' });

  try {
    const searchRes = await axios.get('https://api.tgstat.ru/channels/search', {
      params: { token: TGSTAT_TOKEN, q: query, limit, country: 'ru' }
    });
    const items = searchRes.data?.response?.items || [];
    const results = items.map(ch => {
      const username = (ch.username || '').replace(/^@/, '');
      const erPercent = ch.er ? ch.er * 100 : 0;
      return {
        title: ch.title, username,
        participants: ch.participants_count || 0, participantsFormatted: formatNum(ch.participants_count),
        er: erPercent, erFormatted: erPercent ? erPercent.toFixed(1) + '%' : '—',
        avgPostReach: ch.avg_post_reach || 0, avgPostReachFormatted: formatNum(ch.avg_post_reach),
        category: ch.category || '—',
        verdict: getVerdict({ er: erPercent, err: 0, avgPostReach: ch.avg_post_reach || 0, participants: ch.participants_count || 0, postsCount: 0, dailyReach: 0, ciIndex: ch.ci_index || 0, lastPostDaysAgo: null, avgViews: 0 }),
      };
    });
    res.json({ results, total: results.length });
  } catch (error) {
    console.error('TGStat search error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Ошибка поиска', details: error.message });
  }
});

// ═══════════ ЗАЯВКА НА РАЗБОР ═══════════

app.post('/api/audit', async (req, res) => {
  const { userId, channel, who, income, budget, tried, pain } = req.body;
  try {
    if (userId) {
      await supabase.from('users').upsert(
        { id: parseInt(userId), username: 'tg_user', first_name: 'User' },
        { onConflict: 'id' }
      );
    }
    const { data, error } = await supabase
      .from('audit_requests')
      .insert({
        user_id: userId ? parseInt(userId) : null,
        channel, who, income, budget, tried, pain,
        status: 'new'
      })
      .select();
    if (error) throw error;
    res.json({ success: true, request: data[0] });
  } catch (e) {
    console.error('Audit request error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════ ИСТОРИЯ АНАЛИЗОВ ═══════════

app.get('/api/user/:userId/analyses', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('user_id', parseInt(req.params.userId))
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json({ analyses: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════ ЗАПУСК ═══════════

app.listen(PORT, () => {
  console.log('TG Bee API v2.1 на порту ' + PORT);
  console.log('Supabase + TGStat + Smart Scoring');
});
