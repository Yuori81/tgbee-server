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

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'TG Bee API', version: '2.0.0' });
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

app.get('/api/channel/:username', async (req, res) => {
  const channel = cleanChannel(req.params.username);
  const userId = req.query.userId || null;

  if (!channel) {
    return res.status(400).json({ error: 'Укажите username канала' });
  }

  try {
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

    let stat = null;
    try {
      const statRes = await axios.get('https://api.tgstat.ru/channels/stat', {
        params: { token: TGSTAT_TOKEN, channelId: ch.id }
      });
      stat = statRes.data?.response;
    } catch (e) {
      console.log('TGStat stat (не критично):', e.message);
    }

    const username = (ch.username || channel).replace(/^@/, '');
    const erPercent = stat?.er_percent || (ch.er ? ch.er * 100 : 0);
    const errPercent = stat?.err_percent || 0;
    const er24Percent = stat?.err24_percent || 0;
    const avgPostReach = stat?.avg_post_reach || ch.avg_post_reach || 0;
    const participants = stat?.participants_count || ch.participants_count || 0;
    const dailyReach = stat?.daily_reach || 0;
    const postsCount = stat?.posts_count || 0;
    const verdict = getVerdict(erPercent);

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
        verdict: getVerdict(erPercent),
      };
    });
    res.json({ results, total: results.length });
  } catch (error) {
    console.error('TGStat search error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Ошибка поиска', details: error.message });
  }
});

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

app.listen(PORT, () => {
  console.log('TG Bee API v2.0 на порту ' + PORT);
  console.log('Supabase + TGStat подключены');
});
